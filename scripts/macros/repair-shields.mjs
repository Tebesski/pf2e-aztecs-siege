import { MODULE_ID } from "../constants.mjs"
import {
   slugify,
   ensureSiegeRoll,
   tKey,
   makeModifier,
   capitalize,
   renderHbs,
   tplPath,
} from "../utils.mjs"
import { levelBasedActionDC, resolveActionDC } from "./helpers.mjs"
import { VehicleShieldManager, REPAIR_SHIELDS_SOURCE_KEY } from "../managers/shields.mjs"
import { repairOutcomeResult } from "./repair.mjs"

export async function repairShieldsMacro(crewmanActor = null, siegeActor = null) {
   let crewman = crewmanActor
   let siege = siegeActor

   if (!crewman || !siege) {
      const controlled = canvas.tokens.controlled
      const targets = Array.from(game.user.targets)

      if (controlled.length !== 1 || targets.length !== 1)
         return (
            ui.notifications.warn(tKey("Notifications.SelectOneCrewmanOneSiege")),
            false
         )

      crewman = controlled[0].actor
      siege = targets[0].actor
   }

   if (siege?.type !== "vehicle") {
      ui.notifications.warn(tKey("Notifications.MustBeSiegeWeapon"))
      return false
   }

   const shields = VehicleShieldManager.collectShieldEntries(siege)
   if (shields.length === 0) {
      ui.notifications.warn(tKey("Shield.NoShieldsInstalled"))
      return false
   }

   const states = VehicleShieldManager.shieldStates(siege)
   const options = shields
      .map(({ sourceKey, moduleItem, entry }) => {
         const state =
            states[sourceKey] ||
            VehicleShieldManager.buildShieldState(moduleItem, entry, sourceKey)
         return {
            sourceKey,
            name: state.name,
            currentHp: state.currentHp,
            maxHp: state.maxHp,
            hardness: state.hardness,
            label: `${state.name} (${state.currentHp}/${state.maxHp} HP, AC +${state.acBonus}, Hardness ${state.hardness})`,
         }
      })

   const picked = await _promptRepairShield(options)
   if (!picked) return false

   const autoDC = levelBasedActionDC(crewman)
   const repairAction = _repairShieldsActionFor(siege)
   const repairFlag = repairAction?.getFlag(MODULE_ID, "siegeAction") || {}
   const selectedSkill = _bestRepairSkill(crewman, repairFlag)
   if (!selectedSkill) {
      ui.notifications.warn(tKey("Notifications.MissingCraftingSkill"))
      return false
   }

   const hasEyepiece = _hasCraftersEyepiece(crewman)
   const modifiers = []
   if (hasEyepiece && selectedSkill.slug === "crafting") {
      const eyepieceMod = makeModifier(
         "crafters-eyepiece",
         tKey("Repair.CraftersEyepiece"),
         1,
         "item",
      )
      if (eyepieceMod) modifiers.push(eyepieceMod)
   }

   const rollOptions = [
      "action:repair-shields",
      `repair-skill:${selectedSkill.slug}`,
      ...ensureSiegeRoll(siege),
   ]
   const targetDC = resolveActionDC(crewman, selectedSkill.entry?.dc, autoDC)
   const siegeTokenDoc = siege.getActiveTokens()[0]?.document
   let rollOutcome = null
   let rollCompleted = false
   let rolling = true
   const hookId = Hooks.on("preCreateChatMessage", (msg) => {
      if (!rolling) return
      const type = msg.flags?.pf2e?.context?.type
      if (type && type !== "skill-check") return
      msg.updateSource({
         "speaker.alias": crewman.name,
         [`flags.${MODULE_ID}.repairShield`]: {
            siegeId: siege.id,
            siegeUuid: siege.uuid,
            siegeTokenId: siegeTokenDoc?.id || null,
            sourceKey: picked.sourceKey,
            skill: selectedSkill.slug,
            skillLabel: selectedSkill.label,
            craftersEyepiece: hasEyepiece,
         },
      })
   })

   try {
      await selectedSkill.stat.roll({
         dc: { value: targetDC },
         extraRollOptions: rollOptions,
         modifiers,
         callback: (_roll, outcome) => {
            rollOutcome = outcome
            rollCompleted = true
         },
      })
   } finally {
      rolling = false
      Hooks.off("preCreateChatMessage", hookId)
   }

   if (rollCompleted && rollOutcome) {
      const result = repairOutcomeResult(
         rollOutcome,
         selectedSkill.rank,
         hasEyepiece,
      )
      let hpResult = null
      if (result.kind === "heal" && result.amount > 0) {
         hpResult = await VehicleShieldManager.applyShieldRepair(
            siege,
            picked.sourceKey,
            result.amount,
         )
      } else if (result.kind === "damage") {
         const damageRoll = await new Roll("2d6").evaluate()
         const rawDamage = Math.max(0, Math.floor(Number(damageRoll.total) || 0))
         const hardness = Math.max(0, Number(picked.hardness) || 0)
         const shieldDamage = Math.max(0, rawDamage - hardness)
         hpResult = await VehicleShieldManager.applyShieldRepair(
            siege,
            picked.sourceKey,
            -shieldDamage,
         )
      }

      const previousHp = _numberOr(hpResult?.previousHp, picked.currentHp)
      const nextHp = _numberOr(hpResult?.nextHp, picked.currentHp)
      const maxHp = _numberOr(hpResult?.maxHp, picked.maxHp)
      const amount =
         result.kind === "damage"
            ? Math.max(0, previousHp - nextHp)
            : Math.max(0, nextHp - previousHp)
      await _postShieldRepairResultMessage({
         crewman,
         actionName: repairAction?.name || tKey("Shield.RepairShieldsAction"),
         shieldName: picked.name,
         kind: result.kind === "damage" ? "damage" : "healing",
         amount,
         previousHp,
         nextHp,
         maxHp,
         speakerActor: crewman,
      })
      return true
   }
   return false
}

async function _postShieldRepairResultMessage({
   crewman,
   actionName,
   shieldName,
   kind,
   amount,
   previousHp,
   nextHp,
   maxHp,
   speakerActor = null,
} = {}) {
   const safeCrew = _escapeHTML(crewman?.name || "")
   const safeAction = _escapeHTML(actionName || tKey("Shield.RepairShieldsAction"))
   const safeShield = _escapeHTML(shieldName || "")
   const safeKind = _escapeHTML(kind || "healing")

   await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: speakerActor || crewman }),
      content: tKey("Repair.ResultMessage", {
         crewman: safeCrew,
         action: safeAction,
         target: safeShield,
         result: tKey("Repair.ShieldResultLine", {
            amount: _formatNumber(amount),
            kind: safeKind,
            target: safeShield,
            previous: _formatNumber(previousHp),
            next: _formatNumber(nextHp),
            max: _formatNumber(maxHp),
         }),
      }),
   })
}

function _numberOr(value, fallback = 0) {
   const number = Number(value)
   if (Number.isFinite(number)) return number
   const fallbackNumber = Number(fallback)
   return Number.isFinite(fallbackNumber) ? fallbackNumber : 0
}

function _formatNumber(value) {
   const number = _numberOr(value, 0)
   return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100)
}

function _escapeHTML(value) {
   return foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")
}

async function _promptRepairShield(options) {
   const escape = (s) =>
      foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
   const selectOptions = options
      .map(
         (opt) =>
            `<option value="${escape(opt.sourceKey)}">${escape(opt.label)}</option>`,
      )
      .join("")

   const sourceKey = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("Shield.RepairDialogTitle") },
      content: await renderHbs(tplPath("macros/select-dialog.hbs"), {
         label: tKey("Shield.SelectShieldToRepair"),
         selectId: "siege-repair-shield",
         options: selectOptions,
      }),
      buttons: [
         {
            action: "repair",
            label: tKey("Shield.RepairButton"),
            icon: "fa-solid fa-hammer",
            callback: () =>
               document.getElementById("siege-repair-shield")?.value || null,
         },
         {
            action: "cancel",
            label: tKey("Buttons.Cancel"),
            callback: () => null,
         },
      ],
   }).catch(() => null)

   if (!sourceKey) return null
   return options.find((opt) => opt.sourceKey === sourceKey) || null
}

function _repairShieldsActionFor(siege) {
   return (
      siege.items.find(
         (item) =>
            item.type === "action" &&
            item.getFlag(MODULE_ID, "siegeAction")?.isRepairShields,
      ) ||
      siege.items.find(
         (item) =>
            item.type === "action" &&
            item.getFlag(MODULE_ID, "moduleGenerated")?.sourceKey ===
               REPAIR_SHIELDS_SOURCE_KEY,
      ) ||
      siege.items.find(
         (item) =>
            item.type === "action" &&
            item.name === tKey("Shield.RepairShieldsAction"),
      )
   )
}

function _bestRepairSkill(crewman, flag = {}) {
   const candidates = []
   const seen = new Set()
   const addCandidate = (entry) => {
      const skill = _resolveSkill(crewman, entry)
      if (!skill?.stat) return
      const key = skill.slug || entry.name
      if (seen.has(key)) return
      seen.add(key)
      candidates.push({
         ...skill,
         entry,
         mod: Number(skill.stat.mod) || 0,
         rank: _rankValue(skill.stat),
      })
   }

   addCandidate({ name: "crafting", loreName: "", dc: "" })
   for (const entry of flag.skills || []) addCandidate(entry)
   candidates.sort((a, b) => b.mod - a.mod)
   return candidates[0] || null
}

function _resolveSkill(crewman, entry = {}) {
   const skills = crewman?.skills || {}
   if (entry.name === "lore") {
      const wanted = slugify(entry.loreName)
      const wantedBase = wanted.replace(/-lore$/i, "")
      const stat = Object.values(skills).find((skill) => {
         const skillSlug = slugify(skill.slug || skill.shortform || skill.label || "")
         const skillBase = skillSlug.replace(/-lore$/i, "")
         return skillSlug === wanted || skillBase === wantedBase
      })
      if (!stat) return null
      const clean = wantedBase.replace(/-/g, " ")
      return {
         stat,
         slug: stat.slug || wanted,
         label: tKey("Skills.LoreSuffix", {
            name: clean.replace(/\b\w/g, (char) => char.toUpperCase()),
         }),
      }
   }
   if (entry.name === "perception" && crewman?.perception)
      return {
         stat: crewman.perception,
         slug: "perception",
         label: tKey("Skills.Perception"),
      }
   const stat = skills[entry.name]
   if (!stat) return null
   return {
      stat,
      slug: entry.name,
      label: capitalize(entry.name),
   }
}

function _hasCraftersEyepiece(crewman) {
   return crewman.items.some((item) => {
      const slug = slugify(item.system?.slug || item.slug || item.name)
      return slug === "crafters-eyepiece" || slug === "crafter-s-eyepiece"
   })
}

function _rankValue(stat) {
   const raw =
      stat?.rank ??
      stat?.proficiency?.rank ??
      stat?.proficiency ??
      stat?.system?.proficient?.value ??
      0
   const numeric = Number(raw)
   if (Number.isFinite(numeric)) return Math.max(0, numeric)
   const text = String(raw || "").toLowerCase()
   if (text.includes("legendary")) return 4
   if (text.includes("master")) return 3
   if (text.includes("expert")) return 2
   if (text.includes("trained")) return 1
   return 0
}
