import { MODULE_ID } from "../../constants.mjs"
import { splitCSV, tKey, ensureSiegeRoll } from "../../utils.mjs"

export function readRollContext(detailsBody, flag) {
   const root = _rootElement(detailsBody)
   const rawTraits = splitCSV(flag.traits).map((t) => t.toLowerCase())
   const baseHasNonlethal = rawTraits.includes("nonlethal")

   const nonlethalCb = root?.querySelector?.(".siege-nonlethal-cb")
   const isNonlethalChecked = nonlethalCb
      ? nonlethalCb.checked
      : baseHasNonlethal

   const versatileRadio = root?.querySelector?.(".siege-versatile-radio:checked")
   const versatileTrait =
      versatileRadio && versatileRadio.value !== "base"
         ? versatileRadio.value
         : null
   const versatileType =
      versatileRadio && versatileRadio.value !== "base"
         ? versatileRadio.dataset.type
         : null
   const vehiclePenalty =
      parseInt(root?.querySelector?.(".veh-penalty-select")?.value) || 0

   return {
      baseHasNonlethal,
      isNonlethalChecked,
      versatileTrait,
      versatileType,
      vehiclePenalty,
   }
}

function _rootElement(value) {
   if (value?.jquery) return value[0] || null
   if (value?.querySelector) return value
   return null
}

export function buildCustomOptions(siege, flag, versatileTrait) {
   const options = splitCSV(flag.rollOptions)
   options.push(...ensureSiegeRoll(siege))
   splitCSV(flag.traits).forEach((t) => options.push(`trait:${t}`))
   if (versatileTrait) options.push(versatileTrait)
   if (flag.isRanged !== false) options.push("ignore-range-penalty")
   return options
}

export function calcDistance(siege, isStrike) {
   if (!isStrike) return null
   const targets = Array.from(game.user.targets)
   if (targets.length === 0) return null
   const siegeToken = siege.getActiveTokens()[0]
   const targetToken = targets[0]
   if (!siegeToken || !targetToken) return null
   const gridSize = canvas?.grid?.size || canvas?.dimensions?.size || 100
   const gridDistance =
      Number(canvas?.scene?.grid?.distance) ||
      Number(canvas?.grid?.distance) ||
      5
   const centerOf = (token) => {
      const doc = token.document ?? token
      const width = (doc.width ?? token.w ?? 1) * gridSize
      const height = (doc.height ?? token.h ?? 1) * gridSize
      return {
         x: (doc.x ?? token.x ?? 0) + width / 2,
         y: (doc.y ?? token.y ?? 0) + height / 2,
      }
   }
   const a = centerOf(siegeToken)
   const b = centerOf(targetToken)
   const centerDistance =
      (Math.hypot(a.x - b.x, a.y - b.y) / gridSize) * gridDistance
   const tokenDistance = _safeTokenDistance(siegeToken, targetToken)
   return Number.isFinite(tokenDistance) ? tokenDistance : centerDistance
}

function _safeTokenDistance(origin, target, options = {}) {
   try {
      return origin && target && typeof origin.distanceTo === "function"
         ? origin.distanceTo(target, options)
         : null
   } catch (_err) {
      return null
   }
}

export function validateRange(distance, flag) {
   if (flag.isRanged === false || distance === null) return true
   const blindRange = parseInt(flag.blindRange) || 0
   const maxRange = parseInt(flag.maxRange) || Infinity

   if (blindRange > 0 && distance <= blindRange) {
      ui.notifications.warn(
         tKey("Notifications.TooCloseBlindRange", { range: blindRange }),
      )
      return false
   }
   if (distance > maxRange) {
      ui.notifications.warn(
         tKey("Notifications.TooFarMaxRange", { range: maxRange }),
      )
      return false
   }
   return true
}

export function findMissingPrereqs(siege, flag) {
   const prereqs = flag.prerequisites || []
   return prereqs.filter((p) => {
      if (p.name === "Lifted") {
         return !siege.itemTypes.effect.some(
            (e) =>
               e.name === tKey("Markers.Lifted") &&
               e.getFlag(MODULE_ID, "isPortableMarker"),
         )
      }
      const usedName = tKey("Markers.ActionUsedSuffix", { name: p.name })
      const ef = siege.itemTypes.effect.find((ef) => ef.name === usedName)
      return !ef || (ef.system.badge?.value || 1) < p.count
   })
}
