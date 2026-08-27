export function categoriesListPath(): "/categories" {
  return "/categories";
}

export function categoryCreatePath(): "/categories/new" {
  return "/categories/new";
}

export function categoryEditPath(id: number): `/categories/edit/${number}` {
  return `/categories/edit/${id}`;
}
