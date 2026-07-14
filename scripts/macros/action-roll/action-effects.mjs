import { MODULE_ID } from "../../constants.mjs"
import { tKey, makeModifier, formatProficiency } from "../../utils.mjs"
import { resolveActionDC } from "../helpers.mjs"
import { SiegeSocketManager } from "../../managers/sockets.mjs"
import { applyConsequences } from "../consequences.mjs"

export async function applyActionEffects(siege, actionItem, flag) {
   const prereqs = flag.prerequisites || []
   const prereqNames = new Set(prereqs.map((p) => p.name))

   if (flag.removePrereqsOnUse !== false) {
      const usedSuffix = tKey("Markers.ActionUsedSuffix", {
         name: "@@@",
      }).replace("@@@", "")
      const toDelete = siege.itemTypes.effect.filter((ef) => {
         if (ef.name.startsWith(tKey("Markers.LoadedPrefix", { name: "" })))
            return false
         const base = ef.name.includes(usedSuffix)
            ? ef.name.replace(usedSuffix, "")
            : ef.name
         return prereqNames.has(base) || prereqNames.has(ef.name)
      })
      if (toDelete.length > 0) {
         await SiegeSocketManager.modifySiegeItem(
            siege.uuid,
            "delete",
            toDelete.map((ef) => ef.id),
         )
      }
   }

   const loadName = tKey("ActionTemplates.Load.Name")
   const isRequired =
      actionItem.name === loadName ||
      actionItem.name === "Loading" ||
      siege.items.some(
         (i) =>
            i.type === "action" &&
            (i.getFlag(MODULE_ID, "siegeAction")?.prerequisites || []).some(
               (p) => p.name === actionItem.name,
            ),
      )
   if (!isRequired) return

   const effectName = tKey("Markers.ActionUsedSuffix", {
      name: actionItem.name,
   })
   const existing = siege.itemTypes.effect.find((ef) => ef.name === effectName)

   if (existing) {
      await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", [
         {
            _id: existing.id,
            "system.badge.value": (existing.system.badge?.value || 1) + 1,
         },
      ])
      return
   }

   const durationObj = flag.unlimitedDuration
      ? { value: "unlimited", unit: "unlimited", expiry: null }
      : {
           value: flag.effectDuration || 1,
           unit: "rounds",
           expiry: flag.effectExpiry || "turn-start",
        }

   await SiegeSocketManager.modifySiegeItem(siege.uuid, "create", [
      {
         name: effectName,
         type: "effect",
         img: actionItem.img,
         system: {
            level: { value: 1 },
            duration: durationObj,
            badge: { type: "counter", value: 1 },
            description: {
               value: tKey("Markers.ActionUsedDesc", { name: actionItem.name }),
            },
            tokenIcon: { show: true },
         },
         flags: { [MODULE_ID]: { isSiegeMarker: true } },
      },
   ])
}

export async function handleSkillRoll(
   e,
   skillIdx,
   actionItem,
   crewman,
   siege,
   flag,
   ctx,
) {
   const { autoDC, customOptions, shorthandedPenalty, applyEffects, app } = ctx
   const sData = flag.skills[Number(skillIdx)]
   if (!sData) return false
   const targetDC = resolveActionDC(crewman, sData.dc, autoDC)

   const rollModifiers = []
   if (shorthandedPenalty < 0) {
      const m = makeModifier(
         "shorthanded-penalty",
         tKey("Modifiers.Shorthanded"),
         shorthandedPenalty,
         "circumstance",
      )
      if (m) rollModifiers.push(m)
   }

   let rollOutcome = "success"
   let rollCompleted = false

   const rollArgs = {
      event: e.originalEvent ?? e,
      extraRollOptions: customOptions,
      modifiers: rollModifiers,
      dc: { value: targetDC },
      callback: (_roll, outcome) => {
         rollOutcome = outcome
         rollCompleted = true
      },
   }

   if (sData.name === "lore") {

const wanted = sData.loreName || ""
      const wantedBase = wanted.replace(/-lore$/i, "")
      const loreSkill = Object.values(crewman.skills).find((sk) => {
         const slug = sk.slug || ""
         const slugBase = slug.replace(/-lore$/i, "")
         return slug === wanted || slugBase === wantedBase
      })
      if (!loreSkill) {
         ui.notifications.warn(
            tKey("Notifications.LoreNotFound", {
               name: formatProficiency(sData),
            }),
         )
         return false
      }
      await loreSkill.roll(rollArgs)
   } else if (sData.name === "perception" && crewman.perception) {
      await crewman.perception.roll(rollArgs)
   } else if (crewman.skills[sData.name]) {
      await crewman.skills[sData.name].roll(rollArgs)
   } else {
      ui.notifications.warn(
         tKey("Notifications.SkillNotFound", {
            name: formatProficiency(sData),
         }),
      )
      return false
   }

   if (!rollCompleted) {
      return false
   }
   if (rollOutcome === "failure" || rollOutcome === "criticalFailure") {
      await applyConsequences({
         actionItem,
         flag,
         outcome: rollOutcome,
         crewman,
         siege,
      })
      ui.notifications.warn(
         tKey("Notifications.ActionFailed", { name: actionItem.name }),
      )
      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.ActionFailed", {
            crewman: crewman.name,
            action: actionItem.name,
            siege: siege.name,
         }),
      })
      return false
   }

   await applyEffects()
   ctx?.onOutcome?.(rollOutcome)
   if (!ctx?.deferSuccessConsequences)
      await applyConsequences({
         actionItem,
         flag,
         outcome: rollOutcome,
         crewman,
         siege,
      })
   return true
}
