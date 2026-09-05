export async function collectPaginatedResults<T>(
  fetchPage: (page: number) => Promise<{ results?: T[]; next?: string | null }>,
  maxPages = 50
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchPage(page);
    all.push(...(res.results ?? []));
    if (!res.next) break;
  }
  return all;
}
