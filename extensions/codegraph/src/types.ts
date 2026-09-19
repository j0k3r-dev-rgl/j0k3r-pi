export type CodeGraphAction = "init" | "sync" | "reindex" | "unlock" | "uninit";

export interface CodeGraphStatus {
	initialized: boolean;
	version?: string;
	projectPath: string;
	indexPath?: string;
	lastIndexed?: string | null;
	[key: string]: unknown;
}

export interface CodeGraphBaseDetails {
	path: string;
}

export interface CodeGraphExploreDetails extends CodeGraphBaseDetails {
	query: string;
	maxFiles: number;
	notIndexed?: boolean;
	truncated?: boolean;
	fullOutputPath?: string;
}

export interface CodeGraphStatusDetails extends CodeGraphBaseDetails {
	status: CodeGraphStatus;
}

export interface CodeGraphManageDetails extends CodeGraphBaseDetails {
	action: CodeGraphAction;
	command: string;
	confirmed: boolean;
	executed: boolean;
	status?: CodeGraphStatus;
}

export interface CodeGraphSyncDetails extends CodeGraphBaseDetails {
	executed: boolean;
	notIndexed?: boolean;
	lockHeld?: boolean;
	cached?: boolean;
	durationMs?: number;
	output?: string;
}
