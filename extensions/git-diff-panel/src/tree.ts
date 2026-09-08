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

	const rows: TreeRow[] = [];
	const visit = (node: TreeNode, depth: number) => {
		for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
			const expanded = !collapsedDirs.has(dir.path);
			rows.push({ kind: "dir", name: dir.name, path: dir.path, depth, expanded });
			if (expanded) visit(dir, depth + 1);
		}
		for (const file of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
			rows.push({ kind: "file", name: file.path.split("/").at(-1) ?? file.path, path: file.path, depth, file });
		}
	};
	visit(root, 0);
	return rows;
}

export function nearestFileIndex(rows: TreeRow[], start: number, direction: 1 | -1): number {
	for (let index = start; index >= 0 && index < rows.length; index += direction) {
		if (rows[index]?.kind === "file") return index;
	}
	return start;
}
