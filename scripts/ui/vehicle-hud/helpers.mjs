export const escapeHTML = (value) =>
   foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")

export const capitalizeForHud = (value) =>
   String(value || "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase())

export const MODULE_CANVAS_WIDTH = 2200
export const MODULE_CANVAS_HEIGHT = 1600
export const DEFAULT_MODULE_SLOT_SIZE = 100
