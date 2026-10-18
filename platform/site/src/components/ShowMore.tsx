/**
 * Show more under a paged list (lib/community.ts, usePagedCommunity): reads the next page and appends
 * it. The button says when it is loading, and a line under it says when the page did not load.
 */
export function ShowMore({
  label,
  loadingLabel,
  failedLine,
  loading,
  failed,
  onMore,
}: {
  label: string;
  loadingLabel: string;
  failedLine: string;
  loading: boolean;
  failed: boolean;
  onMore: () => void;
}) {
  return (
    <>
      <p className="list-more">
        <button type="button" className="button button-secondary" onClick={onMore} disabled={loading}>
          {loading ? loadingLabel : label}
        </button>
      </p>
      {failed ? (
        <p role="status" className="small">
          {failedLine}
        </p>
      ) : null}
    </>
  );
}
