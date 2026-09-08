import type { GitChangedFile } from "./git.js";

export interface TreeRow {
	kind: "dir" | "file";
	name: string;
	path: string;
	depth: number;
	expanded?: boolean;
	file?: GitChangedFile;
}

interface TreeNode {
	name: string;
	path: string;
	dirs: Map<string, TreeNode>;
	files: GitChangedFile[];
}

function createNode(name: string, path: string): TreeNode {
	return { name, path, dirs: new Map(), files: [] };
}

function compactNode(node: TreeNode, isRoot = false): TreeNode {
	const newDirs = new Map<string, TreeNode>();
	for (const [key, child] of node.dirs) {
		newDirs.set(key, compactNode(child, false));
	}
	node.dirs = newDirs;

	if (!isRoot && node.files.length === 0 && node.dirs.size === 1) {
		const singleChild = [...node.dirs.values()][0]!;
		return {
			name: `${node.name}/${singleChild.name}`,
			path: singleChild.path,
			dirs: singleChild.dirs,
			files: singleChild.files,
		};
	}

	return node;
}

export function buildTreeRows(files: GitChangedFile[], collapsedDirs = new Set<string>()): TreeRow[] {
	const root = createNode("", "");
	for (const file of files) {
		const parts = file.path.split("/");
		let node = root;
		for (const part of parts.slice(0, -1)) {
			const childPath = node.path ? `${node.path}/${part}` : part;
			let child = node.dirs.get(part);
			if (!child) {
				child = createNode(part, childPath);
				node.dirs.set(part, child);
			}
			node = child;
		}
		node.files.push(file);
	}

	const compactedRoot = compactNode(root, true);

	const rows: TreeRow[] = [];
	const visit = (node: TreeNode, depth: number) => {
		for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
			const expanded = !collapsedDirs.has(dir.path) && ![...collapsedDirs].some((p) => dir.path.startsWith(`${p}/`));
			rows.push({ kind: "dir", name: dir.name, path: dir.path, depth, expanded });
			if (expanded) visit(dir, depth + 1);
		}
		for (const file of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
			rows.push({ kind: "file", name: file.path.split("/").at(-1) ?? file.path, path: file.path, depth, file });
		}
	};
	visit(compactedRoot, 0);
	return rows;
}

export function nearestFileIndex(rows: TreeRow[], start: number, direction: 1 | -1): number {
	for (let index = start; index >= 0 && index < rows.length; index += direction) {
		if (rows[index]?.kind === "file") return index;
	}
	return start;
}
