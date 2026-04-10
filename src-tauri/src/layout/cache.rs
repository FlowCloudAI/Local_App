use crate::layout::constants::CACHE_CAPACITY;
use crate::layout::types::LayoutResponse;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

#[derive(Debug)]
pub struct LayoutCacheState {
    inner: Mutex<LayoutCache>,
}

impl LayoutCacheState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LayoutCache::new(CACHE_CAPACITY)),
        }
    }

    pub fn get(&self, key: &str) -> Option<LayoutResponse> {
        self.inner.lock().ok()?.get(key)
    }

    pub fn put(&self, key: String, value: LayoutResponse) {
        if let Ok(mut cache) = self.inner.lock() {
            cache.put(key, value);
        }
    }
}

#[derive(Debug)]
pub struct LayoutCache {
    capacity: usize,
    entries: HashMap<String, LayoutResponse>,
    order: VecDeque<String>,
}

impl LayoutCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn get(&mut self, key: &str) -> Option<LayoutResponse> {
        if !self.entries.contains_key(key) {
            return None;
        }

        self.touch(key);
        self.entries.get(key).cloned()
    }

    pub fn put(&mut self, key: String, value: LayoutResponse) {
        let key_ref = key.as_str();
        self.entries.insert(key.clone(), value);
        self.touch(key_ref);

        while self.entries.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                if self.entries.remove(&oldest).is_some() {
                    break;
                }
            } else {
                break;
            }
        }
    }

    fn touch(&mut self, key: &str) {
        if let Some(index) = self.order.iter().position(|existing| existing == key) {
            self.order.remove(index);
        }
        self.order.push_back(key.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::LayoutCache;
    use crate::layout::types::LayoutResponse;
    use std::collections::BTreeMap;

    fn empty_response(hash: &str) -> LayoutResponse {
        LayoutResponse {
            positions: BTreeMap::new(),
            bounds: None,
            layout_hash: Some(hash.to_string()),
        }
    }

    #[test]
    fn evicts_least_recently_used_entry() {
        let mut cache = LayoutCache::new(2);

        cache.put("a".to_string(), empty_response("a"));
        cache.put("b".to_string(), empty_response("b"));
        let _ = cache.get("a");
        cache.put("c".to_string(), empty_response("c"));

        assert!(cache.get("a").is_some());
        assert!(cache.get("b").is_none());
        assert!(cache.get("c").is_some());
    }
}
