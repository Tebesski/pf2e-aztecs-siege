import { MODULE_ID } from "../../constants.mjs"
import { slugify, splitCSV } from "../../utils.mjs"

export function actionSlug(action) {
   return slugify(action.system?.slug || action.slug || action.name)
}

export function applyModification(flag, mod) {
   flag.attackBonus = addNumber(flag.attackBonus, mod.attackBonusDelta)
   flag.loadActionsRequired = Math.max(
      0,
      addNumber(flag.loadActionsRequired, mod.loadActionsRequiredDelta),
   )
   flag.maxLoaded = positiveOrBlank(addNumber(flag.maxLoaded, mod.maxLoadedDelta))
   flag.spend = positiveOrBlank(addNumber(flag.spend, mod.spendDelta))
   if (Number(mod.saveDCDelta) !== 0)
      modifySaveDC(flag, Number(mod.saveDCDelta) || 0)
   if (mod.rollOptions) flag.rollOptions = appendCSV(flag.rollOptions, mod.rollOptions)
   if (mod.traits) flag.traits = appendCSV(flag.traits, mod.traits)
   if (mod.modifyRange) {
      flag.isRanged = mod.isRanged !== false
      flag.blindRange = mod.blindRange ?? ""
      flag.minRange = mod.minRange ?? ""
      flag.rangeIncrement = mod.rangeIncrement ?? ""
      flag.maxRange = mod.maxRange ?? ""
   }
   if (mod.modifyArea) {
      flag.areaSize = mod.areaSize ?? 5
      flag.areaType = mod.areaType || "burst"
   }
   if (Array.isArray(mod.damageParts) && mod.damageParts.length) {
      flag.damageParts = Array.isArray(flag.damageParts) ? flag.damageParts : []
      flag.damageParts.push(...foundry.utils.deepClone(mod.damageParts))
   }
   modifyPrerequisite(flag, mod)
   modifySkillDC(flag, mod)
}

export function cleanDisabledModuleIds(ids) {
   const values =
      ids instanceof Set
         ? Array.from(ids)
         : Array.isArray(ids)
            ? ids
            : ids
               ? [ids]
               : []
   return Array.from(
      new Set(
         values
            .map((id) => String(id || "").trim())
            .filter(Boolean),
      ),
   ).sort()
}

export function disabledModulesChanged(changes = {}) {
   const directKeys = [
      `flags.${MODULE_ID}.disabledModules`,
      `flags.${MODULE_ID}.-=disabledModules`,
   ]
   if (directKeys.some((key) => Object.prototype.hasOwnProperty.call(changes, key)))
      return true
   if (
      changes.flags?.[MODULE_ID] &&
      Object.prototype.hasOwnProperty.call(
         changes.flags[MODULE_ID],
         "disabledModules",
      )
   )
      return true
   return Object.keys(changes).some((key) =>
      key.startsWith(`flags.${MODULE_ID}.disabledModules.`),
   )
}

function addNumber(value, delta) {
   const n = Number(value) || 0
   return n + (Number(delta) || 0)
}

function positiveOrBlank(value) {
   if (value === "" || value === null || value === undefined) return ""
   return Math.max(0, Number(value) || 0)
}

function appendCSV(current, addition) {
   const parts = [...splitCSV(current), ...splitCSV(addition)]
   return [...new Set(parts)].join(", ")
}

function modifySaveDC(flag, delta) {
   const wrap = (expr) => `(${expr}) ${delta >= 0 ? "+" : "-"} ${Math.abs(delta)}`
   if (Array.isArray(flag.saveDCPaths) && flag.saveDCPaths.length) {
      flag.saveDCPaths = flag.saveDCPaths.map((expr) => wrap(expr))
   } else if (flag.saveDC !== undefined && flag.saveDC !== "") {
      flag.saveDCPaths = [wrap(flag.saveDC)]
   } else {
      flag.saveDCPaths = [String(10 + delta)]
   }
}

function modifyPrerequisite(flag, mod) {
   const name = String(mod.prerequisiteName || "").trim()
   const delta = Number(mod.prerequisiteDelta) || 0
   if (!name || delta === 0) return
   flag.prerequisites = Array.isArray(flag.prerequisites) ? flag.prerequisites : []
   const target = flag.prerequisites.find((p) => p.name === name)
   if (!target) return
   target.count = Math.max(0, (Number(target.count) || 1) + delta)
   flag.prerequisites = flag.prerequisites.filter((p) => (Number(p.count) || 0) > 0)
}

function modifySkillDC(flag, mod) {
   const delta = Number(mod.skillDCDelta) || 0
   const skillName = slugify(mod.skillName)
   const loreName = slugify(mod.skillLoreName)
   if (!delta || !skillName) return
   flag.skills = Array.isArray(flag.skills) ? flag.skills : []
   for (const skill of flag.skills) {
      if (slugify(skill.name) !== skillName) continue
      if (skillName === "lore" && loreName && slugify(skill.loreName) !== loreName)
         continue
      skill.dc = wrapDc(skill.dc, delta)
   }
}

function wrapDc(dc, delta) {
   const base = dc === "" || dc === null || dc === undefined ? "0" : String(dc)
   if (/^-?\d+(\.\d+)?$/.test(base)) return String((Number(base) || 0) + delta)
   return `(${base}) ${delta >= 0 ? "+" : "-"} ${Math.abs(delta)}`
}
