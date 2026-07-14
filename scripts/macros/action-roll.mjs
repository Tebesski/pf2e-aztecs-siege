import { MODULE_ID } from "../constants.mjs"
import {
   slugify,
   splitCSV,
   capitalize,
   tKey,
   ensureSiegeRoll,
   makeModifier,
   getSiegeTokenId,
   getCrewActors,
   buildMountedSiegeRules,
   siegeOffensiveEffectRuleUpdates,
   findMountedSiegeStrike,
   renderHbs,
   tplPath,
} from "../utils.mjs"
import { computeBestModifier, resolveSaveDC } from "./helpers.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"
import {
   applyConsequences,
   normalizeConsequenceOutcome,
   outcomeFromRollResult,
} from "./consequences.mjs"
import { deductAmmo } from "./action-roll/ammunition-flow.mjs"
import { withSiegeOriginToken } from "./action-roll/range-origin.mjs"
export {
   readRollContext,
   buildCustomOptions,
   calcDistance,
   validateRange,
   findMissingPrereqs,
} from "./action-roll/roll-context.mjs"
export {
   deductAmmo,
   hasSpendableAmmo,
   advanceLoadProgressOrReady,
   clearLoadProgressAfterLoad,
   canAttemptWeaponReload,
   handleLoadingFlow,
} from "./action-roll/ammunition-flow.mjs"
export {
   applyActionEffects,
   handleSkillRoll,
} from "./action-roll/action-effects.mjs"
export {
   withSiegeOriginToken,
   withSiegeRangeOrigin,
} from "./action-roll/range-origin.mjs"

export async function handleAbilityAttack(
   actionItem,
   siege,
   flag,
   detailsBody,
   applyEffects,
   crewman = null,
) {
   if (crewman)
      await ensureMountedSiegeRules({
         crewman,
         siege,
      })

   const isAreaOrSave =
      flag.actionType === "area-fire" ||
      flag.actionType === "auto-fire" ||
      flag.actionType === "save-single"

   if (!isAreaOrSave) {
      await actionItem.toMessage(undefined, {
         speaker: ChatMessage.getSpeaker({ actor: siege }),
      })
      await applyEffects()
      return
   }

   const damageParts = flag.damageParts || []
   const damageFormula = damageParts
      .map((p) => {
         const faces = p.die === "-" ? "" : p.die
         const base = `${p.dice}${faces}`
         const tags = [p.type]
         if (p.category && p.category !== "normal") tags.push(p.category)
         return `${base}[${tags.join(",")}]`
      })
      .join(",")

   let finalAreaType = flag.areaType
   let finalAreaSize = flag.areaSize

   if (_checked(detailsBody, ".siege-corner-shot-cb")) {
      if (flag.areaType === "burst") {
         finalAreaType = "line"
         finalAreaSize = flag.areaSize * 2
      } else if (flag.areaType === "line") {
         finalAreaType = "burst"
         finalAreaSize = Math.max(5, flag.areaSize / 2)
      }
   }

   const inlineTemplate =
      flag.actionType === "save-single"
         ? ""
         : `@Template[type:${finalAreaType}|distance:${finalAreaSize}]`
   const resolvedDC = resolveSaveDC(crewman, flag)
   const inlineSave = `@Check[type:reflex|dc:${resolvedDC}|traits:${flag.actionType}|showDC:all]`
   const damageOptions = [
      ...ensureSiegeRoll(siege),
      ...splitCSV(flag.rollOptions),
   ]
   const damageTraits = splitCSV(flag.traits)
   const damageParams = [
      "domains:strike-damage",
      damageOptions.length > 0 ? `options:${damageOptions.join(",")}` : "",
      damageTraits.length > 0 ? `traits:${damageTraits.join(",")}` : "",
   ].filter(Boolean)
   const inlineDamage = `@Damage[${damageFormula}|${damageParams.join("|")}]`

   const ephemeralData = actionItem.toObject()
   ephemeralData.system.description.value += `<hr><p class="siege-ability-template">${inlineTemplate}</p><p class="siege-ability-save">${inlineSave}</p><p class="siege-ability-damage">${inlineDamage}</p>`

   const rollActor = crewman || siege
   const tempAttack = new Item.implementation(ephemeralData, { parent: rollActor })
   const siegeTokenDoc = siege.getActiveTokens()[0]?.document
   const hookId = Hooks.once("preCreateChatMessage", (msg) => {
      msg.updateSource({
         "speaker.alias": siege.name,
         "flags.pf2e.origin.uuid": actionItem.uuid,
         "flags.pf2e.origin.type": actionItem.type,
         [`flags.${MODULE_ID}.siegeId`]: siege.id,
         [`flags.${MODULE_ID}.siegeUuid`]: siege.uuid,
         [`flags.${MODULE_ID}.siegeTokenId`]: siegeTokenDoc?.id || null,
      })
   })

   try {
      await tempAttack.toMessage(undefined, {
         speaker: ChatMessage.getSpeaker({ actor: rollActor }),
      })
      await applyEffects()
   } finally {
      Hooks.off("preCreateChatMessage", hookId)
   }
}

export async function handleStrike(e, actionItem, siege, crewman, flag, ctx) {
   const {
      customOptions,
      rollContext,
      shorthandedPenalty,
      distance,
      isPortable,
      detailsBody,
      applyEffects,
      app,
   } = ctx
   const strikeLabel = actionItem.name

   const highestStr = _calcHighestStr(isPortable, detailsBody, siege)
   let generatedStrike = await ensureMountedSiegeRules({
      crewman,
      siege,
      strikeLabel,
      versatileType: rollContext.versatileType,
      flag: { ...flag, actionId: actionItem.id },
      highestStr,
   })
   if (generatedStrike === "missing") generatedStrike = null
   generatedStrike ||= findMountedSiegeStrike(crewman, strikeLabel, siege)
   if (!generatedStrike) {
      ui.notifications.warn(tKey("Notifications.StrikeNotFoundRemount"))
      return false
   }

   const weaponMod = generatedStrike.totalModifier
   const { bestMod, bestSkillName } = computeBestModifier(
      crewman,
      flag,
      weaponMod,
      siege,
   )
   const modDiff = bestMod - weaponMod

   const choice = await _showStrikeOptionsDialog(actionItem, flag)
   if (!choice) return false

   if (flag.usesAmmunition !== false) {
      if (!(await deductAmmo(siege, flag, actionItem))) return false
   }

   const modifiers = _buildStrikeModifiers(choice, {
      modDiff,
      bestSkillName,
      shorthandedPenalty,
      flag,
      distance,
      rollContext,
   })

   const siegeTokenId = getSiegeTokenId(siege)
   let rolling = true
   let attackOutcome = null

   const hookId = Hooks.on("preCreateChatMessage", (msg) => {
      if (!rolling) return
      const type = msg.flags?.pf2e?.context?.type
      if (type !== "attack-roll") return
      attackOutcome =
         normalizeConsequenceOutcome(msg.flags?.pf2e?.context?.outcome) ||
         attackOutcome
      _updateAttackMessage(msg, {
         siege,
         siegeTokenId,
         actionItem,
         flag,
         strikeLabel,
         crewman,
         rollContext,
      })
   })

   let rollResult = null
   try {
      const strikeActor = generatedStrike.item?.actor || crewman
      rollResult = await withSiegeOriginToken(
         strikeActor,
         siege,
         () =>
            generatedStrike.variants[choice.mapIndex].roll({
               event: e.originalEvent ?? e,
               modifiers,
               options: customOptions,
            }),
         { phase: "attack", strikeLabel, target: game.user.targets.first() },
      )
   } finally {
      rolling = false
      Hooks.off("preCreateChatMessage", hookId)
   }

   await applyConsequences({
      actionItem,
      flag,
      outcome: outcomeFromRollResult(rollResult) || attackOutcome || "no-roll",
      crewman,
      siege,
   })
   await applyEffects()
   app.close()
   return true
}

function _safeTokenDistance(origin, target, options = {}) {
   return _safeCall(() =>
      origin && target && typeof origin.distanceTo === "function"
         ? origin.distanceTo(target, options)
         : null,
   )
}

function _safeCall(callback) {
   try {
      return callback()
   } catch (err) {
      return { error: err?.message || String(err) }
   }
}

function _calcHighestStr(isPortable, detailsBody, siege) {
   if (!isPortable) return 0
   const checkbox = _query(detailsBody, ".siege-highest-str-cb")
   if (checkbox && !checkbox.checked) return 0
   let highestStr = 0
   for (const actor of getCrewActors(siege)) {
      const strMod = actor.system.abilities?.str?.mod || 0
      if (strMod > highestStr) highestStr = strMod
   }
   return highestStr
}

function _query(root, selector) {
   if (root?.jquery) return root[0]?.querySelector?.(selector) || null
   return root?.querySelector?.(selector) || null
}

function _checked(root, selector) {
   return !!_query(root, selector)?.checked
}

export async function ensureMountedSiegeRules({
   crewman,
   siege,
   strikeLabel = "",
   versatileType = null,
   flag = null,
   highestStr = 0,
   force = false,
} = {}) {
   if (!crewman || !siege) return null
   await _normalizeSiegeOffensiveEffectRules(siege)
   const mountedEffect = crewman.itemTypes.effect.find(
      (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
   )
   if (!mountedEffect) return null

   const chosenPosition = mountedEffect.getFlag(MODULE_ID, "position")
   const rebuiltRules = buildMountedSiegeRules(siege, chosenPosition, crewman, {
      strikeLabel,
      actionId: flag?.actionId,
      flag,
      versatileType,
   })
   const newRules = foundry.utils.deepClone(rebuiltRules)

   const existingStrIdx = newRules.findIndex(
      (r) => r.slug === "siege-str-damage",
   )
   if (highestStr > 0) {
      if (existingStrIdx >= 0) newRules.splice(existingStrIdx, 1)
      newRules.push({
         key: "FlatModifier",
         slug: "siege-str-damage",
         selector: "strike-damage",
         predicate: [`siege-weapon:${slugify(siege.name)}`],
         value: highestStr,
         type: "untyped",
         label: tKey("Modifiers.CrewStrengthBonus"),
      })
   }

   const currentRules = mountedEffect.system.rules || []
   const rulesChanged = JSON.stringify(currentRules) !== JSON.stringify(newRules)
   const currentStrike = strikeLabel
      ? findMountedSiegeStrike(crewman, strikeLabel, siege)
      : null
   if (!rulesChanged && !force) return currentStrike

   await SiegeSocketManager.modifySiegeItem(
      crewman.uuid,
      "update",
      [{ _id: mountedEffect.id, "system.rules": newRules }],
      { siegeActionRuleSync: true },
   )
   await _waitForDocumentUpdate()
   const refreshedCrewman = await _resolveFreshActor(crewman)
   const updated = findMountedSiegeStrike(refreshedCrewman, strikeLabel, siege)
   return strikeLabel ? updated || "missing" : null
}

async function _normalizeSiegeOffensiveEffectRules(siege) {
   const updates = siegeOffensiveEffectRuleUpdates(siege)
   if (updates.length === 0) return
   await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", updates, {
      siegeEffectRuleNormalize: true,
   })
   await _waitForDocumentUpdate()
}

async function _resolveFreshActor(actor) {
   if (!actor?.uuid) return actor
   try {
      const doc = await fromUuid(actor.uuid)
      return doc?.actor || doc || actor
   } catch {
      return actor
   }
}

const _waitForDocumentUpdate = () =>
   new Promise((resolve) => setTimeout(resolve, 0))

async function _showStrikeOptionsDialog(actionItem, flag) {
   const traits = splitCSV(flag.traits).map((trait) => trait.toLowerCase())
   const agile = traits.includes("agile")
   const mapButtons = flag.subjectToMAP
      ? [
           { action: "map0", label: tKey("ActionMacro.NoMAP"), mapIndex: 0 },
           {
              action: "map1",
              label: tKey("ActionMacro.MAPPenalty", { value: agile ? "-4" : "-5" }),
              mapIndex: 1,
           },
           {
              action: "map2",
              label: tKey("ActionMacro.MAPPenalty", { value: agile ? "-8" : "-10" }),
              mapIndex: 2,
           },
        ]
      : [{ action: "map0", label: tKey("ActionMacro.NoMAP"), mapIndex: 0 }]
   const choiceFrom = (mapIndex) => ({
      mapIndex,
      sit:
         parseInt(document.getElementById("siege-sit-mod")?.value) ||
         0,
   })
   const content = await renderHbs(tplPath("macros/strike-options-dialog.hbs"), {
      label: tKey("ActionMacro.SituationalModifier"),
   })
   return foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog", "siege-attack-map-dialog"],
      window: {
         title: tKey("ActionMacro.RollOptionsTitle", { name: actionItem.name }),
      },
      position: { width: 490 },
      content,
      buttons: mapButtons.map((button) => ({
         action: button.action,
         label: button.label,
         icon: "fa-solid fa-dice-d20",
         callback: () => choiceFrom(button.mapIndex),
      })),
   })
}

function _buildStrikeModifiers(choice, ctx) {
   const {
      modDiff,
      bestSkillName,
      shorthandedPenalty,
      flag,
      distance,
      rollContext,
   } = ctx
   const modifiers = []

   if (choice.sit !== 0) {
      const m = makeModifier(
         "situational",
         tKey("Modifiers.Situational"),
         choice.sit,
         "untyped",
      )
      if (m) modifiers.push(m)
   }

   if (rollContext.baseHasNonlethal && !rollContext.isNonlethalChecked) {
      const m = makeModifier(
         "lethal-penalty",
         tKey("Modifiers.LethalPenalty"),
         -2,
         "circumstance",
      )
      if (m) modifiers.push(m)
   }

   if (modDiff > 0) {
      const m = makeModifier(
         "skill-substitution",
         tKey("Modifiers.SkillBonus", { name: bestSkillName }),
         modDiff,
         "untyped",
      )
      if (m) modifiers.push(m)
   }

   if (shorthandedPenalty < 0) {
      const m = makeModifier(
         "shorthanded-penalty",
         tKey("Modifiers.Shorthanded"),
         shorthandedPenalty,
         "circumstance",
      )
      if (m) modifiers.push(m)
   }

   if (rollContext.vehiclePenalty < 0) {
      const m = makeModifier(
         "vehicle-attack-penalty",
         tKey("Modifiers.VehicleAttackPenalty"),
         rollContext.vehiclePenalty,
         "circumstance",
      )
      if (m) modifiers.push(m)
   }

const rangeIncrement = parseInt(flag.rangeIncrement) || 0
   if (
      flag.isRanged !== false &&
      distance !== null &&
      rangeIncrement > 0 &&
      distance > rangeIncrement
   ) {
      const increments = Math.ceil(distance / rangeIncrement)
      const penalty = -2 * Math.max(0, increments - 1)
      if (penalty < 0) {
         const m = makeModifier(
            "range-increment",
            tKey("Modifiers.RangePenalty"),
            penalty,
            "untyped",
         )
         if (m) modifiers.push(m)
      }
   }

   const minRange = parseInt(flag.minRange) || 0
   if (
      flag.isRanged !== false &&
      distance !== null &&
      minRange > 0 &&
      distance <= minRange
   ) {
      const m = makeModifier(
         "volley",
         tKey("Modifiers.Volley"),
         -2,
         "circumstance",
      )
      if (m) modifiers.push(m)
   }

   return modifiers
}

function _updateAttackMessage(msg, ctx) {
   const {
      siege,
      siegeTokenId,
      actionItem,
      flag,
      strikeLabel,
      crewman,
      rollContext,
   } = ctx
   const currentTraits = msg.flags?.pf2e?.context?.traits || []
   let newTraits = [...currentTraits]

   if (!newTraits.some((t) => t.name === "siege-weapon")) {
      newTraits.push({
         name: "siege-weapon",
         label: tKey("Traits.SiegeWeapon"),
      })
   }

   for (const t of splitCSV(flag.traits)) {
      if (!newTraits.some((existing) => existing.name === t)) {
         newTraits.push({ name: t, label: capitalize(t) })
      }
   }

   if (rollContext.baseHasNonlethal && !rollContext.isNonlethalChecked) {
      newTraits = newTraits.filter((t) => t.name !== "nonlethal")
   }
   const storedTraitSlugs = splitCSV(flag.traits).filter(
      (t) =>
         !(
            t === "nonlethal" &&
            rollContext.baseHasNonlethal &&
            !rollContext.isNonlethalChecked
         ),
   )

   const updates = {
      "speaker.alias": siege.name,
      "speaker.token": siegeTokenId,
      "flags.pf2e.origin.uuid": actionItem.uuid,
      "flags.pf2e.origin.type": actionItem.type,
      "flags.pf2e.context.traits": newTraits,
      [`flags.${MODULE_ID}.crewmanId`]: crewman.id,
      [`flags.${MODULE_ID}.crewmanUuid`]: crewman.uuid,
      [`flags.${MODULE_ID}.strikeLabel`]: strikeLabel,
      [`flags.${MODULE_ID}.siegeId`]: siege.id,
      [`flags.${MODULE_ID}.siegeUuid`]: siege.uuid,
      [`flags.${MODULE_ID}.siegeTokenId`]: siegeTokenId,
      [`flags.${MODULE_ID}.rollOptions`]: flag.rollOptions || "",
      [`flags.${MODULE_ID}.traits`]: storedTraitSlugs.join(", "),
      [`flags.${MODULE_ID}.resolvedFlag`]: {
         ...foundry.utils.deepClone(flag),
         traits: storedTraitSlugs.join(", "),
      },
   }

   if (
      rollContext.versatileType &&
      msg.flags?.pf2e?.strike?.item?.system?.damage
   ) {
      updates["flags.pf2e.strike.item.system.damage.damageType"] =
         rollContext.versatileType
      updates[`flags.${MODULE_ID}.versatileType`] = rollContext.versatileType
   }

   msg.updateSource(updates)
}
