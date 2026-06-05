import {
   MODULE_ID,
   DAMAGE_COLOR_MAP,
   DAMAGE_ICON_MAP,
   WEAPON_PROFS,
} from "../constants.mjs"
import {
   slugify,
   splitCSV,
   tKey,
   capitalize,
   formatProficiency,
   getProficiencies,
   countOccupants,
   getCrewActors,
   makeModifier,
} from "../utils.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"







export const resolveSaveDC = (crewman, flag) => {
   const exprs = Array.isArray(flag?.saveDCPaths)
      ? flag.saveDCPaths.filter((s) => String(s ?? "").trim() !== "")
      : []
   
   if (exprs.length === 0 && flag?.saveDC != null && flag.saveDC !== "")
      exprs.push(String(flag.saveDC))

   const rollData = _rollDataFor(crewman)
   const values = exprs
      .map((raw) => _evalDcExpression(String(raw), rollData, crewman))
      .filter((val) => Number.isFinite(val))
   if (values.length > 0) return Math.floor(Math.max(...values))

   
   const classDC =
      crewman?.system?.attributes?.classDC?.value ??
      crewman?.system?.attributes?.classOrSpellDC?.value ??
      foundry.utils.getProperty(rollData, "classDC") ??
      null
   if (Number.isFinite(classDC)) return Math.floor(classDC)
   return 10
}

export const resolveActionDC = (crewman, dc, fallback = 10) => {
   if (dc === "" || dc === null || dc === undefined) return fallback
   const val = _evalDcExpression(String(dc), _rollDataFor(crewman), crewman)
   return Number.isFinite(val) ? Math.floor(val) : fallback
}

const _rollDataFor = (crewman) => {
   try {
      return crewman?.getRollData?.() || {}
   } catch {
      return {}
   }
}



const _evalDcExpression = (expr, rollData, crewman) => {
   let s = String(expr).trim()
   if (s === "") return NaN
   
   if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s)

   
   
   let missing = false
   s = s.replace(/@([\w.\-]+)/g, (_m, path) => {
      const v = _resolveRollPath(path, rollData, crewman)
      if (!Number.isFinite(v)) {
         missing = true
         return "NaN"
      }
      return `(${v})`
   })
   if (missing) return NaN

   
   
   const stripped = s.replace(
      /\b(min|max|floor|ceil|round|abs)\b/g,
      "",
   )
   if (!/^[\d+\-*/%.,()\s]*$/.test(stripped)) return NaN

   try {
      
      const fn = new Function(
         "min",
         "max",
         "floor",
         "ceil",
         "round",
         "abs",
         `"use strict"; return (${s});`,
      )
      const out = fn(
         Math.min,
         Math.max,
         Math.floor,
         Math.ceil,
         Math.round,
         Math.abs,
      )
      return Number.isFinite(out) ? out : NaN
   } catch {
      return NaN
   }
}

const _resolveRollPath = (path, rollData, crewman) => {
   const direct = _numeric(foundry.utils.getProperty(rollData, path))
   if (Number.isFinite(direct)) return direct

   const system = crewman?.system || {}
   const systemDirect = _numeric(foundry.utils.getProperty(system, path))
   if (Number.isFinite(systemDirect)) return systemDirect

   if (path === "classDC") {
      return _numeric(
         system.attributes?.classDC?.value ??
            system.attributes?.classOrSpellDC?.value,
      )
   }

   const skillMatch = /^skills\.([^.]+)(?:\.(.*))?$/.exec(path)
   if (skillMatch) {
      const skill = _findSkill(crewman, skillMatch[1])
      if (!skill) return NaN
      const tail = skillMatch[2] || ""
      if (tail === "" || tail === "mod") return _numeric(skill.mod)
      if (tail === "dc" || tail === "dc.value") {
         const dc = _numeric(skill.dc?.value ?? skill.dc)
         if (Number.isFinite(dc)) return dc
         const mod = _numeric(skill.mod)
         return Number.isFinite(mod) ? mod + 10 : NaN
      }
      return _numeric(foundry.utils.getProperty(skill, tail))
   }

   const attrMatch = /^attributes\.(classDC|classOrSpellDC)\.value$/.exec(path)
   if (attrMatch) {
      return _numeric(system.attributes?.[attrMatch[1]]?.value)
   }

   return NaN
}

const _findSkill = (crewman, slug) => {
   const wanted = slugify(slug)
   const wantedBase = wanted.replace(/-lore$/i, "")
   const skills = crewman?.skills || {}
   return (
      skills[wanted] ||
      skills[wantedBase] ||
      Object.values(skills).find((sk) => {
         const skSlug = slugify(sk?.slug || sk?.shortform || sk?.label || "")
         const skBase = skSlug.replace(/-lore$/i, "")
         return skSlug === wanted || skBase === wantedBase
      })
   )
}

const _numeric = (value) => {
   if (value == null || value === "") return NaN
   const n = Number(value)
   return Number.isFinite(n) ? n : NaN
}




export const meetsLoadActionsRequired = (siege, flag) => {
   const need = parseInt(flag?.loadActionsRequired) || 0
   if (need <= 0) return true
   const loadName = tKey("ActionTemplates.Load.Name")
   const usedName = tKey("Markers.ActionUsedSuffix", { name: loadName })
   const ef = siege.itemTypes.effect.find((e) => e.name === usedName)
   const have = ef ? ef.system.badge?.value || 0 : 0
   return have >= need
}





export const meetsRequiredRank = (siege, crewman, flag) => {
   let required = Array.isArray(flag?.requiredRanks) ? flag.requiredRanks : []
   if (required.length === 0 && flag?.requiredRank) required = [flag.requiredRank]
   if (required.length === 0) return true
   if (game?.user?.isGM) return true
   if (!siege.getFlag(MODULE_ID, "ranksEnabled")) return true
   const ranks = siege.getFlag(MODULE_ID, "ranks") || []
   
   const validReq = required.filter((n) => ranks.some((r) => r.name === n))
   if (validReq.length === 0) return true
   const byVeh = crewman?.getFlag?.(MODULE_ID, "rankByVehicle") || {}
   let held = byVeh[siege.id]
   if (!held) {
      const eff = crewman?.itemTypes?.effect?.find(
         (e) =>
            e.getFlag(MODULE_ID, "siegeId") === siege.id &&
            e.getFlag(MODULE_ID, "position"),
      )
      held = eff?.getFlag(MODULE_ID, "rank")
   }
   if (!held) return false
   return validReq.includes(held)
}

export const getActionsForCrew = (siege, position, crewman = null) =>
   siege.items.filter((a) => {
      if (a.type !== "action") return false
      const flag = a.getFlag(MODULE_ID, "siegeAction")
      if (!flag) return false
      const accessOk =
         !flag.crewAccess ||
         flag.crewAccess.length === 0 ||
         flag.crewAccess.includes(position)
      if (!accessOk) return false
      
      if (crewman && !meetsRequiredRank(siege, crewman, flag)) return false
      return true
   })

export const getAmmoInfo = (siege, flag, action = null) => {
   if (flag.usesAmmunition === false)
      return { name: null, loaded: 0, max: tKey("Misc.Infinity") }

   const ammoChoices = AmmunitionManager.ammoTypesForAction(siege, flag)
   if (ammoChoices.length === 0)
      return { name: tKey("Ammunition.TypeUnassigned"), loaded: 0, max: "-" }

   
   
   const loaded = action
      ? AmmunitionManager.getStrikeLoaded(siege, action)
      : 0
   const max = action ? AmmunitionManager.strikeMaxLoaded(action) : "-"
   const activePiece = action
      ? AmmunitionManager.getActiveLoadedPiece(siege, action)
      : null
   const usesCharges = !!activePiece?.usesCharges
   const chargeText = usesCharges
      ? ` (${tKey("Weaponry.Charges", {
           n: activePiece.charges,
        })})`
      : ""
   return {
      name: activePiece?.name || ammoChoices.map(({ type }) => type.name).join(" / "),
      loaded: `${loaded}${chargeText}`,
      max,
   }
}

export const computePrereqData = (siege, flag, action = null) => {
   const stored = (flag.prerequisites || []).map((p) => {
      let fulfilled = false
      let current = 0
      const required =
         p.name === "Lifted" ? siege.getFlag(MODULE_ID, "bulk") || 0 : p.count

      if (p.name === "Lifted") {
         fulfilled = siege.itemTypes.effect.some(
            (e) =>
               e.name === tKey("Markers.Lifted") &&
               e.getFlag(MODULE_ID, "isPortableMarker"),
         )
         current = fulfilled ? required : 0
      } else {
         const usedName = tKey("Markers.ActionUsedSuffix", { name: p.name })
         const ef = siege.itemTypes.effect.find((ef) => ef.name === usedName)
         current = ef ? ef.system.badge?.value || 1 : 0
         fulfilled = current >= p.count
      }
      return {
         name: p.name,
         current,
         required,
         fulfilled,
         showCount: p.name !== "Lifted",
      }
   })

   const isAmmoAttack =
      (flag.isStrike || flag.isAttack) && flag.usesAmmunition !== false
   if (!isAmmoAttack) return stored

   const spend = parseInt(flag.spend) || 1
   const activePiece = action
      ? AmmunitionManager.getActiveLoadedPiece(siege, action)
      : null
   
   
   
   const loaded = action ? AmmunitionManager.getStrikeLoaded(siege, action) : 0
   const max = action ? AmmunitionManager.strikeMaxLoaded(action) : spend
   const templates = siege.getFlag(MODULE_ID, "loadedAmmoTemplates") || {}
   const tplCharge = action
      ? AmmunitionManager._chargeInfo(templates[action.id])
      : { usesCharges: false, max: 0 }
   const loadedCharges =
      activePiece?.usesCharges
         ? [activePiece.charges]
         : action && tplCharge.usesCharges
         ? (() => {
              const stored = AmmunitionManager.getStrikeLoadedCharges(siege, action)
              return stored.length > 0
                 ? stored
                 : Array.from({ length: loaded }, () => tplCharge.max)
           })()
         : []
   const totalLoadedCharges = loadedCharges.reduce((sum, n) => sum + n, 0)
   const fulfilled = activePiece?.usesCharges || tplCharge.usesCharges
      ? totalLoadedCharges >= spend
      : loaded >= spend
   const displayCount = `${loaded} / ${max}`

   const loadedEntry = {
      name: tKey("AttackTemplates.Loaded.Name"),
      current: tplCharge.usesCharges ? totalLoadedCharges : loaded,
      required: spend,
      fulfilled,
      showCount: true,
      displayCount,
   }
   return [loadedEntry, ...stored]
}

export const computeCornerShot = (crewman, flag) => {
   const hasCornerShot = crewman.items.some(
      (i) =>
         i.system?.slug === "cannon-corner-shot" ||
         i.slug === "cannon-corner-shot",
   )
   if (!hasCornerShot) return null
   if (flag.actionType !== "area-fire" && flag.actionType !== "auto-fire")
      return null

   if (flag.areaType === "burst") {
      return { newType: "line", newSize: (parseInt(flag.areaSize) || 5) * 2 }
   }
   if (flag.areaType === "line") {
      return {
         newType: "burst",
         newSize: Math.max(5, (parseInt(flag.areaSize) || 10) / 2),
      }
   }
   return null
}

export const buildDamageTagsHtml = (damageParts) =>
   (damageParts || [])
      .map((dp) => {
         const color = DAMAGE_COLOR_MAP[dp.type] || "#aaaaaa"
         const icon = DAMAGE_ICON_MAP[dp.type] || "fa-burst"
         const val = dp.die === "-" ? dp.dice : `${dp.dice}${dp.die}`
         const category = dp.category !== "normal" ? `(${dp.category})` : ""
         return `<span class="siege-damage-tag" style="border-color:${color};"><i class="fa-solid ${icon}" style="color:${color};"></i> <strong>${val}</strong> ${capitalize(dp.type)} ${category}</span>`
      })
      .join("")

export const versatileOptionsFor = (flag) => {
   const rawTraits = splitCSV(flag.traits).map((t) => t.toLowerCase())
   const versatileTraits = rawTraits.filter((t) => t.startsWith("versatile-"))
   return versatileTraits.map((t) => {
      const typeChar = t.split("-")[1]
      const typeMap = { p: "piercing", s: "slashing", b: "bludgeoning" }
      return {
         trait: t,
         label: tKey("ActionMacro.VersatilePrefix", {
            letter: typeChar?.toUpperCase() ?? "",
         }),
         type: typeMap[typeChar] || typeChar,
      }
   })
}

export const computeCrewStatus = (siege) => {
   const crewPositions = siege.getFlag(MODULE_ID, "crew") || []
   let totalMissing = 0
   let hasShorthanded = false
   const missingDetails = []

   for (const act of getCrewActors(siege)) {
      if (
         act.items.some(
            (i) =>
               i.system?.slug === "shorthanded" || i.slug === "shorthanded",
         )
      ) {
         hasShorthanded = true
      }
   }

   for (const pos of crewPositions) {
      const occupants = countOccupants(siege, pos.title)
      const minReq = parseInt(pos.min) || 1
      const missing = Math.max(0, minReq - occupants)
      if (missing > 0) {
         totalMissing += missing
         const plural = missing > 1 && !pos.title.endsWith("s") ? "s" : ""
         missingDetails.push(`${missing} ${pos.title}${plural}`)
      }
   }

   let crewBlocked = false
   let shorthandedPenalty = 0
   let missingCrewString = ""

   if (totalMissing > 0) {
      if (hasShorthanded && totalMissing <= 5) {
         shorthandedPenalty = -2 * totalMissing
         missingCrewString = tKey("ActionMacro.Missing", {
            details: missingDetails.join(", "),
         })
      } else {
         crewBlocked = true
      }
   }

   return { totalMissing, crewBlocked, shorthandedPenalty, missingCrewString }
}

export const computeBestModifier = (crewman, flag, weaponMod = 0, siege = null) => {
   let bestMod = weaponMod
   let bestSkillName = tKey("Modifiers.BaseDamage")

   const profs = getProficiencies(flag)
   for (const p of profs) {
      if (p.name === "lore") {
         const loreSkill = Object.values(crewman.skills).find(
            (sk) => sk.slug === p.loreName || sk.slug === p.loreName?.replace(/-lore$/, ""),
         )
         if (loreSkill && loreSkill.mod > bestMod) {
            bestMod = loreSkill.mod
            bestSkillName = formatProficiency(p)
         }
      } else if (crewman.skills[p.name]) {
         if (crewman.skills[p.name].mod > bestMod) {
            bestMod = crewman.skills[p.name].mod
            bestSkillName = capitalize(p.name)
         }
      }
   }

   return { bestMod, bestSkillName }
}

export const ensureSiegeCSS = () => {
   if (document.getElementById("module-css")) return
   const link = document.createElement("link")
   link.id = "module-css"
   link.rel = "stylesheet"
   link.href = `modules/${MODULE_ID}/styles/module.css`
   document.head.appendChild(link)
}

export const formatSignedMod = (mod) => `${mod >= 0 ? "+" : ""}${mod}`

export const hookSpeakerOverride = (siege, extraFlags = {}, msgType = null) => {
   const siegeTokenId = siege.getActiveTokens()[0]?.document?.id || null
   const hookId = Hooks.on("preCreateChatMessage", (msg) => {
      if (msgType && msg.flags?.pf2e?.context?.type !== msgType) return
      msg.updateSource({
         "speaker.alias": siege.name,
         "speaker.token": siegeTokenId,
         ...extraFlags,
      })
   })
   return hookId
}
