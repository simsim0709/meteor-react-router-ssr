import LRU from 'lru-cache';

const lruCacheOptions = {
  max: 500,
  maxAge: 1000 * 60 * 60,
};

const _cache = LRU(lruCacheOptions);

export function setCachePage(userId = 'NOT_LOGGED_IN', key, data) {
  _cache.set(`${userId}:${key}`, data);
}

export function getCachePage(userId = 'NOT_LOGGED_IN', key) {
  console.log('userId, key', userId, key);
  return _cache.get(`${userId}:${key}`);
}

export function writeFromCache(originalWrite, html) {
  return function () {
    originalWrite.call(this, html);
  };
}
