export interface ProtocolToAdapter {}

export type Protocol = Extract<keyof ProtocolToAdapter, string>
