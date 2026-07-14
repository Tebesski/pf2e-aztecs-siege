import { MODULE_ID } from "../constants.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"
import {
   slugify,
   isSiege,
   ensureSiegeRoll,
   tKey,
   makeModifier,
   capitalize,
} from "../utils.mjs"
import { levelBasedActionDC, resolveActionDC } from "./helpers.mjs"

const RNT_MODULE_ID = "pf2e-aztecs-rip-n-tear"

export async function repairMacro(crewmanActor = null, siegeActor = null) {
   let crewman = crewmanActor
   let siege = siegeActor

   if (!crewman || !siege) {
      const controlled = canvas.tokens.controlled
      const targets = Array.from(game.user.targets)

      if (controlled.length !== 1 || targets.length !== 1)
         return (
            ui.notifications.warn(
               tKey("Notifications.SelectOneCrewmanOneSiege"),
            ),
            false
         )

      crewman = controlled[0].actor
      siege = targets[0].actor
   }

   if (!isSiege(siege)) {
      ui.notifications.warn(tKey("Notifications.MustBeSiegeWeapon"))
      return false
   }

   const autoDC = levelBasedActionDC(crewman)
   const repairAction = _repairActionFor(siege)
   const repairFlag = repairAction?.getFlag(MODULE_ID, "siegeAction") || {}
   const selectedSkill = _bestRepairSkill(crewman, repairFlag)
   if (!selectedSkill) {
      ui.notifications.warn(tKey("Notifications.MissingCraftingSkill"))
      return false
   }

   const rntRepairTarget = await _promptRipAndTearRepairTarget(siege, crewman)
   if (rntRepairTarget === false) return false

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

   const options = [
      "action:repair",
      `repair-skill:${selectedSkill.slug}`,
      ...ensureSiegeRoll(siege),
   ]
   const targetDC = resolveActionDC(
      crewman,
      selectedSkill.entry?.dc,
      autoDC,
   )
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
         [`flags.${MODULE_ID}.repairSiege`]: {
            siegeId: siege.id,
            siegeUuid: siege.uuid,
            siegeTokenId: siegeTokenDoc?.id || null,
            skill: selectedSkill.slug,
            skillLabel: selectedSkill.label,
            craftersEyepiece: hasEyepiece,
         },
      })
   })

   try {
      await selectedSkill.stat.roll({
         dc: { value: targetDC },
         extraRollOptions: options,
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
      const result = await postRepairResultMessage({
         crewman,
         actionName: repairAction?.name || tKey("ActionTemplates.Repair.Name"),
         targetName: rntRepairTarget?.label || siege.name,
         outcome: rollOutcome,
         rank: selectedSkill.rank,
         hasEyepiece,
         speakerActor: crewman,
         plainHealingResult: rntRepairTarget?.type === "part",
         plainDamageResult: rntRepairTarget?.type === "part",
      })
      const appliedRipAndTear = await _applyRipAndTearRepairResult(
         siege,
         rntRepairTarget,
         result,
         {
            crewman,
            repairAction,
         },
      )
      if (!appliedRipAndTear && rntRepairTarget?.type !== "part")
         await _applyVehicleRepairResult(siege, result)
      return true
   }
   return false
}

async function _applyVehicleRepairResult(siege, result) {
   if (!siege || !result) return false
   if (result.kind === "heal" && result.amount > 0)
      return SiegeSocketManager.applyVehicleHpDelta(siege, Number(result.amount))
   if (result.kind === "damage" && result.amount > 0)
      return SiegeSocketManager.applyVehicleHpDelta(siege, -Number(result.amount))
   return false
}

function _ripAndTearApi() {
   return (
      globalThis.game?.modules?.get?.(RNT_MODULE_ID)?.api ??
      globalThis.PF2eAztecsRipNTear ??
      null
   )
}

async function _promptRipAndTearRepairTarget(siege, crewman) {
   const api = _ripAndTearApi()
   if (
      !api?.hasVehicleRepairTargets?.(siege) ||
      typeof api.promptVehicleRepairTarget !== "function"
   )
      return null

   try {
      return await api.promptVehicleRepairTarget(siege, { crewman })
   } catch (_err) {
      return null
   }
}

async function _applyRipAndTearRepairResult(
   siege,
   repairTarget,
   result,
   context = {},
) {
   if (!repairTarget || repairTarget.type !== "part") return false

   const api = _ripAndTearApi()
   if (typeof api?.applySiegeRepairResult !== "function") return false

   try {
      return await api.applySiegeRepairResult(
         siege,
         repairTarget,
         result,
         context,
      )
   } catch (_err) {
      return false
   }
}

function _repairActionFor(siege) {
   const names = [
      tKey("ActionTemplates.Repair.Name"),
      tKey("ActionMacro.Repair"),
      "Repair",
   ]
   return siege.items.find(
      (item) => item.type === "action" && names.includes(item.name),
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

export function repairOutcomeResult(outcome, rank, hasEyepiece) {
   const profRank = Math.max(0, Number(rank) || 0)
   const success = hasEyepiece ? 10 + 10 * profRank : 5 + 5 * profRank
   const critical = hasEyepiece ? 15 + 15 * profRank : 10 + 10 * profRank
   if (outcome === "criticalSuccess")
      return {
         kind: "heal",
         amount: critical,
         resultText: String(critical),
      }
   if (outcome === "success")
      return {
         kind: "heal",
         amount: success,
         resultText: String(success),
      }
   if (outcome === "criticalFailure")
      return {
         kind: "damage",
         amount: null,
         formula: "2d6",
      }
   return { kind: "none", amount: 0, inline: "" }
}

export async function resolveRepairOutcomeResult(outcome, rank, hasEyepiece) {
   const result = repairOutcomeResult(outcome, rank, hasEyepiece)
   if (result.kind !== "damage") return result
   const roll = await new Roll(result.formula || "2d6").evaluate()
   result.amount = Math.max(0, Math.floor(Number(roll.total) || 0))
   result.resultText = `${result.formula || "2d6"} = ${result.amount}`
   return result
}

export async function postRepairResultMessage({
   crewman,
   actionName,
   targetName,
   outcome,
   rank,
   hasEyepiece,
   speakerActor = null,
   plainHealingResult = false,
   plainDamageResult = false,
} = {}) {
   const result = await resolveRepairOutcomeResult(outcome, rank, hasEyepiece)
   const escape = (value) =>
      foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")
   const safeCrew = escape(crewman?.name || "")
   const safeAction = escape(actionName || tKey("ActionTemplates.Repair.Name"))
   const safeTarget = escape(targetName || "")
   let resultLine = ""
   if (result.kind === "heal") {
      resultLine = plainHealingResult
         ? tKey("Repair.ResultPlainHealLine", {
              amount: escape(result.amount),
              target: safeTarget,
           })
         : tKey("Repair.ResultHealLine", {
              inline: escape(result.resultText || result.amount),
              target: safeTarget,
           })
   } else if (result.kind === "damage") {
      resultLine = plainDamageResult
         ? tKey("Repair.ResultPlainDamageLine", {
              amount: escape(result.amount),
              target: safeTarget,
           })
         : tKey("Repair.ResultDamageLine", {
              inline: escape(result.resultText || result.amount),
              target: safeTarget,
           })
   } else {
      resultLine = tKey("Repair.ResultNoEffectLine", { target: safeTarget })
   }

   await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: speakerActor || crewman }),
      content: tKey("Repair.ResultMessage", {
         crewman: safeCrew,
         action: safeAction,
         target: safeTarget,
         result: resultLine,
      }),
   })
   return result
}
