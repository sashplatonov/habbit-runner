/* eslint-disable complexity */
import { browser } from '$app/environment';
import { replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import type { PathnameWithSearchOrHash } from '$app/types';

export type DashboardUrlState = {
  filter?: 'pending' | 'all' | 'done' | 'archived';
  search?: string;
  tags?: string;
  sort?: 'custom' | 'smart';
  density?: 'comfortable' | 'compact';
  collapsed?: string;
};

export function readDashboardStateFromURL(): Partial<DashboardUrlState> {
  if (!browser) { return {}; }

  const params = new URLSearchParams(window.location.search);
  const state: Partial<DashboardUrlState> = {};

  const filter = params.get('filter');
  if (filter === 'pending' || filter === 'all' || filter === 'done' || filter === 'archived') { state.filter = filter; }
  const search = params.get('search');
  if (search !== null && search.trim().length <= 200) { state.search = search.trim(); }
  const tags = parseTagsFromURL(params.get('tags') ?? undefined);
  if (tags.length > 0) { state.tags = stringifyTagsForURL(tags); }
  const sort = params.get('sort');
  if (sort === 'custom' || sort === 'smart') { state.sort = sort; }
  const density = params.get('density');
  if (density === 'comfortable' || density === 'compact') { state.density = density; }
  if (params.has('collapsed')) { state.collapsed = params.get('collapsed') ?? undefined; }

  return state;
}

export function updateDashboardURL(state: Partial<DashboardUrlState>) {
  if (!browser) { return; }

  const url = new URL(window.location.href);
  const params = url.searchParams;

  // Update or remove each param
  if ('filter' in state) {
    if (state.filter && state.filter !== 'pending') {
      params.set('filter', state.filter);
    } else {
      params.delete('filter');
    }
  }

  if ('search' in state) {
    if (state.search) {
      params.set('search', state.search);
    } else {
      params.delete('search');
    }
  }

  if ('tags' in state) {
    if (state.tags) {
      params.set('tags', state.tags);
    } else {
      params.delete('tags');
    }
  }

  if ('sort' in state) {
    if (state.sort && state.sort !== 'custom') {
      params.set('sort', state.sort);
    } else {
      params.delete('sort');
    }
  }

  if ('density' in state) {
    if (state.density && state.density !== 'comfortable') {
      params.set('density', state.density);
    } else {
      params.delete('density');
    }
  }

  if ('collapsed' in state) {
    if (state.collapsed === 'true') {
      params.set('collapsed', 'true');
    } else {
      params.delete('collapsed');
    }
  }

  // Keep dashboard state shareable without triggering a route navigation.
  const queryString = params.toString();
  const newUrl = url.pathname + (queryString ? '?' + queryString : '') + url.hash;
  if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
    replaceState(resolve(newUrl as PathnameWithSearchOrHash, {} as never), {});
  }
}

export function parseTagsFromURL(tagsParam: string | undefined): string[] {
  if (!tagsParam) {return [];}
  return tagsParam.split(',').map(t => t.trim())
    .filter((tag, index, tags) => tag.length > 0 && tag.length <= 40 && tags.indexOf(tag) === index)
    .slice(0, 50);
}

export function stringifyTagsForURL(tags: string[]): string {
  return tags.join(',');
}
