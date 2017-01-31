import LRU from 'lru-cache';

const lruCacheOptions = {
  max: 500,
  maxAge: 1000 * 60 * 60,
};

export const _cache = LRU(lruCacheOptions);

export const setCachePage = (key, data, userId = 'NOT_LOGGED_IN') => {
  _cache.set(key, data);
};

export const getCachePage = (key, userId = 'NOT_LOGGED_IN') => {
  const cachedPage = _cache.get(key);
  // console.log('getCachePage', key);

  return cachedPage;
};

export const hasCachePage = (key) => {
  return _cache.has(key);
};
