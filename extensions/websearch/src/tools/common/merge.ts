export function interleaveGroups<T>(groups: T[][], limit: number): T[] {
  const items: T[] = [];
  let index = 0;
  while (items.length < limit) {
    let added = false;
    for (const group of groups) {
      const item = group[index];
      if (item === undefined) continue;
      items.push(item);
      added = true;
      if (items.length >= limit) break;
    }
    if (!added) break;
    index += 1;
  }
  return items;
}
