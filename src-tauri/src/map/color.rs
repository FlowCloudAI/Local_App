use crate::map::constants::{SHAPE_FILL_PALETTE, SHAPE_LINE_PALETTE};
use crate::map::types::MapRgbaColor;

pub fn shape_fill_color(index: usize, value: Option<&str>) -> MapRgbaColor {
    hex_to_rgba_color(value, SHAPE_FILL_PALETTE[index % SHAPE_FILL_PALETTE.len()])
}

pub fn shape_line_color(index: usize, value: Option<&str>) -> MapRgbaColor {
    hex_to_rgba_color(value, SHAPE_LINE_PALETTE[index % SHAPE_LINE_PALETTE.len()])
}

fn hex_to_rgba_color(value: Option<&str>, fallback: MapRgbaColor) -> MapRgbaColor {
    let Some(value) = value else {
        return fallback;
    };

    let normalized = value.trim().trim_start_matches('#');
    if normalized.len() != 6 || !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return fallback;
    }

    let r = u8::from_str_radix(&normalized[0..2], 16).ok();
    let g = u8::from_str_radix(&normalized[2..4], 16).ok();
    let b = u8::from_str_radix(&normalized[4..6], 16).ok();

    match (r, g, b) {
        (Some(r), Some(g), Some(b)) => [r, g, b, fallback[3]],
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_alpha_from_fallback() {
        assert_eq!(shape_fill_color(0, Some("#abcdef")), [171, 205, 239, 88]);
    }

    #[test]
    fn invalid_hex_falls_back_to_palette() {
        assert_eq!(shape_line_color(1, Some("#xyzxyz")), [66, 104, 21, 255]);
    }
}
