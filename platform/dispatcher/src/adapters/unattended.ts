// Unattended adapter: the managed adapter (managed.ts). Each card runs as a Claude Managed Agents
// session on the studio organisation's key, in a container Anthropic hosts; the dispatcher starts no
// agent process of its own in this mode and has no process-spawn path for one. The key lives under
// its own name in the dispatcher environment and only the SDK client reads it.
export { ManagedAdapter as UnattendedAdapter, type ManagedAdapterOptions as UnattendedOptions } from './managed.js';

export const STUDIO_KEY_ENV = 'STUDIO_ANTHROPIC_API_KEY';
