#!/usr/bin/env bash
# oracle-launch.sh: creates the dispatcher's Oracle Cloud instance from the Mac
# (docs/specs/oracle-launch.md). It builds the network if there is none, launches Ubuntu 24.04 on
# VM.Standard.A1.Flex with 4 OCPUs and 24 GB, retries every availability domain while Oracle
# answers "Out of host capacity", waits for RUNNING, and proves ssh as ubuntu and as root.
# Idempotent: every step finds what exists before it creates, so a rerun reuses the network and an
# instance already named peanutgallery-dispatcher, and prints the same address.
#
# Before the first run, the board signs in once in a terminal (a browser login, no API key):
#   oci session authenticate --region ca-toronto-1 --profile-name peanutgallery
# Then, at the repository root:
#   platform/ops/oracle-launch.sh
#
# OCI_PROFILE names the session profile (default peanutgallery). SSH_PUBLIC_KEY names the key the
# instance trusts (default ~/.ssh/id_ed25519.pub). ROUNDS caps the capacity retries (default 240,
# one round over every availability domain each ROUND_SECONDS, default 60). The session is
# refreshed each round, which holds for 24 hours from the sign-in.
# The last line is the address: VPS_IP=<public ip>.
set -euo pipefail

OCI_PROFILE=${OCI_PROFILE:-peanutgallery}
SSH_PUBLIC_KEY=${SSH_PUBLIC_KEY:-$HOME/.ssh/id_ed25519.pub}
ROUNDS=${ROUNDS:-240}
ROUND_SECONDS=${ROUND_SECONDS:-60}
NAME=peanutgallery-dispatcher
VCN_NAME=peanutgallery-vcn
SHAPE=VM.Standard.A1.Flex
SHAPE_CONFIG='{"ocpus":4,"memoryInGBs":24}'
OCI_CONFIG=${OCI_CLI_CONFIG_FILE:-$HOME/.oci/config}

log() { printf 'oracle-launch: %s\n' "$*" >&2; }
die() { log "$*"; exit 1; }
oci_() { oci --auth security_token --profile "$OCI_PROFILE" "$@"; }

command -v oci > /dev/null 2>&1 || die "oci is not on PATH (brew install oci-cli)"
[ -f "$SSH_PUBLIC_KEY" ] || die "$SSH_PUBLIC_KEY not found (ssh-keygen -t ed25519 -f ${SSH_PUBLIC_KEY%.pub})"
[ -f "$OCI_CONFIG" ] || die "$OCI_CONFIG not found: sign in first with oci session authenticate"

TENANCY=$(awk -v p="[$OCI_PROFILE]" '$0 == p { on = 1; next } /^\[/ { on = 0 } on && /^tenancy *=/ { sub(/^tenancy *= */, ""); print; exit }' "$OCI_CONFIG")
[ -n "$TENANCY" ] || die "profile $OCI_PROFILE has no tenancy in $OCI_CONFIG"
oci_ session validate > /dev/null 2>&1 || die "the $OCI_PROFILE session has expired: run oci session authenticate again"

first() { # prints the query result, or nothing for null
  local out
  out=$(oci_ "$@" --raw-output 2> /dev/null || true)
  [ "$out" = "null" ] || printf '%s' "$out"
}

# --- network: a VCN, an internet gateway, a default route, one public subnet ------------------
VCN=$(first network vcn list -c "$TENANCY" --display-name "$VCN_NAME" --lifecycle-state AVAILABLE --query 'data[0].id')
if [ -z "$VCN" ]; then
  log "creating VCN $VCN_NAME"
  VCN=$(oci_ network vcn create -c "$TENANCY" --display-name "$VCN_NAME" --cidr-blocks '["10.0.0.0/16"]' \
    --dns-label pgvcn --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi
IGW=$(first network internet-gateway list -c "$TENANCY" --vcn-id "$VCN" --query 'data[0].id')
if [ -z "$IGW" ]; then
  log "creating internet gateway"
  IGW=$(oci_ network internet-gateway create -c "$TENANCY" --vcn-id "$VCN" --is-enabled true \
    --display-name peanutgallery-igw --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi
RT=$(oci_ network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
if [ "$(first network route-table get --rt-id "$RT" --query "length(data.\"route-rules\"[?destination=='0.0.0.0/0'])")" != "1" ]; then
  log "adding the default route"
  oci_ network route-table update --rt-id "$RT" --force --wait-for-state AVAILABLE \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" > /dev/null
fi
SL=$(oci_ network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
SUBNET=$(first network subnet list -c "$TENANCY" --vcn-id "$VCN" --lifecycle-state AVAILABLE --query 'data[0].id')
if [ -z "$SUBNET" ]; then
  log "creating public subnet"
  SUBNET=$(oci_ network subnet create -c "$TENANCY" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 \
    --display-name peanutgallery-public --dns-label pgpublic --route-table-id "$RT" \
    --security-list-ids "[\"$SL\"]" --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi

# The dispatcher publishes no port: the only TCP or UDP ingress allowed is TCP 22.
OPEN=$(oci_ network security-list get --security-list-id "$SL" --raw-output --query \
  "join(' ', data.\"ingress-security-rules\"[?protocol=='all' || protocol=='17' || (protocol=='6' && (\"tcp-options\"==null || \"tcp-options\".\"destination-port-range\".min!=\`22\` || \"tcp-options\".\"destination-port-range\".max!=\`22\`))].protocol)")
[ -z "$OPEN" ] || die "the security list opens more than TCP 22 (protocols: $OPEN); close it in the console"
log "security list: inbound TCP 22 only"

# --- the instance --------------------------------------------------------------------------------
INSTANCE=$(first compute instance list -c "$TENANCY" --display-name "$NAME" \
  --query "data[?\"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'].id | [0]")
if [ -n "$INSTANCE" ]; then
  log "reusing $NAME"
  oci_ compute instance get --instance-id "$INSTANCE" --wait-for-state RUNNING > /dev/null
else
  IMAGE=$(oci_ compute image list -c "$TENANCY" --operating-system "Canonical Ubuntu" --operating-system-version 24.04 \
    --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --raw-output \
    --query "data[?!contains(\"display-name\", 'Minimal')].id | [0]")
  [ -n "$IMAGE" ] && [ "$IMAGE" != "null" ] || die "no Canonical Ubuntu 24.04 image for $SHAPE in this region"
  ADS=$(oci_ iam availability-domain list -c "$TENANCY" --query "join(' ', data[].name)" --raw-output)
  # Root takes the same key as ubuntu, so the ops runbook's ssh root@ steps work as written.
  USER_DATA=$(mktemp "${TMPDIR:-/tmp}/oracle-launch.XXXXXX")
  trap 'rm -f "$USER_DATA"' EXIT
  printf '#cloud-config\ndisable_root: false\n' > "$USER_DATA"

  round=1
  while [ -z "$INSTANCE" ]; do
    for ad in $ADS; do
      log "round $round/$ROUNDS: launching in $ad"
      if out=$(oci_ compute instance launch -c "$TENANCY" --availability-domain "$ad" --display-name "$NAME" \
          --shape "$SHAPE" --shape-config "$SHAPE_CONFIG" --image-id "$IMAGE" --subnet-id "$SUBNET" \
          --assign-public-ip true --ssh-authorized-keys-file "$SSH_PUBLIC_KEY" --user-data-file "$USER_DATA" \
          --wait-for-state RUNNING --query 'data.id' --raw-output 2>&1); then
        INSTANCE=$(printf '%s\n' "$out" | grep -E '^ocid1\.instance\.' | tail -n 1)
        [ -n "$INSTANCE" ] || die "launch succeeded but printed no instance id: $out"
        break
      fi
      case $out in
        *"Out of host capacity"* | *"out of host capacity"* | *InternalError*) log "no capacity in $ad" ;;
        *) die "launch failed: $out" ;;
      esac
    done
    [ -n "$INSTANCE" ] && break
    [ "$round" -lt "$ROUNDS" ] || die "no capacity after $ROUNDS rounds; rerun later, or use any Ubuntu 24.04 host"
    round=$((round + 1))
    sleep "$ROUND_SECONDS"
    oci_ session refresh > /dev/null 2>&1 || die "the session could not be refreshed: sign in again and rerun"
  done
fi
log "RUNNING: $INSTANCE"

IP=$(oci_ compute instance list-vnics --instance-id "$INSTANCE" --query 'data[0]."public-ip"' --raw-output)
[ -n "$IP" ] && [ "$IP" != "null" ] || die "the instance has no public IPv4 address"

# --- ssh as ubuntu, then as root -----------------------------------------------------------------
for user in ubuntu root; do
  tries=0
  until reply=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 \
      -i "${SSH_PUBLIC_KEY%.pub}" "$user@$IP" 'echo ok' 2> /dev/null) && [ "$reply" = "ok" ]; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || die "ssh $user@$IP did not answer ok within 10 minutes"
    sleep 10
  done
  log "ssh $user@$IP: ok"
done

echo "VPS_IP=$IP"
