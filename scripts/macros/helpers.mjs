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
   makeModifier,
} from "../utils.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"

export const getActionsForCrew = (siege, position) =>
   siege.items.filter((a) => {
      if (a.type !== "action") return false
      const flag = a.getFlag(MODULE_ID, "siegeAction")
      return (
         flag &&
         (!flag.crewAccess ||
            flag.crewAccess.length === 0 ||
            flag.crewAccess.includes(position))
      )
   })

export const getAmmoInfo = (siege, flag) => {
   if (flag.usesAmmunition === false || !flag.ammoSlug)
      return { name: null, loaded: 0, max: tKey("Misc.Infinity") }

   const targetSlug = slugify(flag.ammoSlug)
   const ammoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || []
   const found = ammoTypes.find((t) => slugify(t.slug || t.name) === targetSlug)
   return {
      name: found ? found.name : flag.ammoSlug,
      loaded: AmmunitionManager.getCurrentAmmoCount(siege, targetSlug),
      max:
         found?.max === "" || found?.max == null
            ? tKey("Misc.Infinity")
            : found.max,
   }
}

export const computePrereqData = (siege, flag) =>
   (flag.prerequisites || []).map((p) => {
      let fulfilled = false
      let current = 0
      const required =
         p.name === "Lifted"
            ? siege.getFlag(MODULE_ID, "bulk") || 0
            : p.count

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
      return { name: p.name, current, required, fulfilled, showCount: p.name !== "Lifted" }
   })

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

   for (const act of game.actors) {
      const onSiege = act.itemTypes.effect.some(
         (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (onSiege) {
         if (
            act.items.some(
               (i) =>
                  i.system?.slug === "shorthanded" || i.slug === "shorthanded",
            )
         ) {
            hasShorthanded = true
         }
      }
   }

   for (const pos of crewPositions) {
      const occupants = countOccupants(siege, pos.title)
      const minReq = parseInt(pos.min) || 1
      const missing = Math.max(0, minReq - occupants)
      if (missing > 0) {
         totalMissing += missing
         const plural =
            missing > 1 && !pos.title.endsWith("s") ? "s" : ""
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

export const computeBestModifier = (crewman, flag, weaponMod = 0) => {
   let bestMod = weaponMod
   let bestSkillName = tKey("Modifiers.BaseDamage")

   for (const p of getProficiencies(flag)) {
      if (p.name === "lore") {
         const loreSkill = Object.values(crewman.skills).find(
            (sk) => sk.slug === p.loreName,
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
