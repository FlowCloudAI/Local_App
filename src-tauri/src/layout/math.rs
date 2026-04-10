use crate::layout::constants::{FIXED_RANDOM_SEED, MIN_DISTANCE};
use std::f64::consts::TAU;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct Vec2 {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

impl Vec2 {
    pub(crate) fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub(crate) fn length(self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    pub(crate) fn dot(self, rhs: Vec2) -> f64 {
        self.x * rhs.x + self.y * rhs.y
    }
}

impl std::ops::Add<Vec2> for Vec2 {
    type Output = Vec2;

    fn add(self, rhs: Vec2) -> Self::Output {
        Vec2::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl std::ops::Sub<Vec2> for Vec2 {
    type Output = Vec2;

    fn sub(self, rhs: Vec2) -> Self::Output {
        Vec2::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl std::ops::AddAssign<Vec2> for Vec2 {
    fn add_assign(&mut self, rhs: Vec2) {
        self.x += rhs.x;
        self.y += rhs.y;
    }
}

impl std::ops::SubAssign<Vec2> for Vec2 {
    fn sub_assign(&mut self, rhs: Vec2) {
        self.x -= rhs.x;
        self.y -= rhs.y;
    }
}

impl std::ops::Mul<f64> for Vec2 {
    type Output = Vec2;

    fn mul(self, rhs: f64) -> Self::Output {
        Vec2::new(self.x * rhs, self.y * rhs)
    }
}

pub(crate) fn safe_direction(delta: Vec2, fallback: Vec2) -> Vec2 {
    let length = delta.length();
    if length <= MIN_DISTANCE {
        fallback
    } else {
        delta * (1.0 / length)
    }
}

pub(crate) fn deterministic_unit(seed: u64) -> Vec2 {
    let angle = unit_angle(seed);
    Vec2::new(angle.cos(), angle.sin())
}

pub(crate) fn unit_angle(seed: u64) -> f64 {
    let mixed = splitmix64(seed);
    let fraction = (mixed as f64) / (u64::MAX as f64);
    TAU * fraction
}

pub(crate) fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(FIXED_RANDOM_SEED);
    value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^ (value >> 31)
}

pub(crate) fn fnv64(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET_BASIS;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

pub(crate) fn fnv64_hex(bytes: &[u8]) -> String {
    format!("{:016x}", fnv64(bytes))
}
