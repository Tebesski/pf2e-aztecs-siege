import {
   MODULE_ID,
   PF2E_DAMAGE_TYPES,
   DAMAGE_CATEGORIES,
   DIE_SIZES,
} from "../constants.mjs"
import { capitalize, getCrewActors, renderHbs, slugify, tKey, tplPath } from "../utils.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"
import { SiegeSettings } from "../managers/settings.mjs"
import { ConsequenceCardManager } from "../managers/consequence-cards.mjs"

const OUTCOME_MAP = {
   "critical-success": "criticalSuccess",
   criticalSuccess: "criticalSuccess",
   criticalsuccess: "criticalSuccess",
   success: "success",
   failure: "failure",
   "critical-failure": "criticalFailure",
   criticalFailure: "criticalFailure",
   criticalfailure: "criticalFailure",
   "no-roll": "no-roll",
   noroll: "no-roll",
}

const OUTCOME_BY_DOS = {
   0: "criticalFailure",
   1: "failure",
   2: "success",
   3: "criticalSuccess",
}

export function normalizeConsequenceOutcome(value) {
   if (value == null) return null
   if (typeof value === "number") return OUTCOME_BY_DOS[value] || null
   const key = String(value).trim()
   return OUTCOME_MAP[key] || OUTCOME_MAP[key.replace(/\s+/g, "-")] || null
}

export function outcomeFromRollResult(result) {
   const context =
      result?.flags?.pf2e?.context ||
      result?.message?.flags?.pf2e?.context ||
      result?.options ||
      {}
   return (
      normalizeConsequenceOutcome(result?.degreeOfSuccess) ||
      normalizeConsequenceOutcome(result?.outcome) ||
      normalizeConsequenceOutcome(context?.outcome) ||
      normalizeConsequenceOutcome(context?.degreeOfSuccess)
   )
}

export async function applyConsequences({
   actionItem,
   flag,
   outcome = "no-roll",
   crewman,
   siege,
} = {}) {
   const normalizedOutcome = normalizeConsequenceOutcome(outcome) || "no-roll"
   const consequences = Array.isArray(flag?.consequences)
      ? flag.consequences
      : []
   if (consequences.length === 0) return

   for (const consequence of consequences) {
      const consequenceOutcome =
         normalizeConsequenceOutcome(consequence?.outcome) || "no-roll"
      if (
         consequenceOutcome !== "no-roll" &&
         consequenceOutcome !== normalizedOutcome
      )
         continue

      const targets = _targetsFor(consequence, crewman, siege)
      if (targets.length === 0) continue

      try {
         const ctx = { actionItem, crewman, siege }
         if (consequence.type === "deal-damage")
            await _rollHpConsequence(consequence, targets, ctx, "damage")
         else if (consequence.type === "heal")
            await _rollHpConsequence(consequence, targets, ctx, "heal")
         else if (consequence.type === "saving-throw")
            await ConsequenceCardManager.postSavingThrowCard({
               consequence,
               targets,
               actionItem,
               crewman,
               siege,
            })
         else {
            const confirmed = await _confirmConsequence(consequence, targets, ctx)
            if (!confirmed) continue
            for (const target of targets)
               await _applyConsequenceToTarget(consequence, target, ctx)
         }
      } catch (_err) {
         ui.notifications.warn(
            tKey("Notifications.ConsequenceFailed", {
               name: actionItem?.name || "",
            }),
         )
      }
   }
}

function _targetsFor(consequence, crewman, siege) {
   if (consequence?.target === "vehicle") return siege ? [siege] : []
   if (consequence?.target === "all-crewmembers")
      return siege ? getCrewActors(siege).filter(Boolean) : []
   return crewman ? [crewman] : []
}

async function _applyConsequenceToTarget(consequence, target, ctx) {
   switch (consequence?.type) {
      case "apply-condition":
         return _applyCondition(consequence, target, ctx)
      case "remove-condition":
         return _removeCondition(consequence, target)
      case "apply-effect":
         return _applyEffect(consequence, target)
      case "remove-effect":
         return _removeEffect(consequence, target)
      case "apply-rule-element":
         return _applyRuleElement(consequence, target, ctx)
      default:
         return null
   }
}

async function _applyCondition(consequence, target, ctx) {
   const slug = slugify(consequence?.condition)
   if (!slug || !target) return
   const condition = _conditionDocument(slug)
   if (!condition)
      return ui.notifications.warn(
         tKey("Notifications.UnknownPF2eCondition", { slug }),
      )

   if (consequence.hasDuration)
      return _createItems(target, [_conditionEffectSource(consequence, condition, ctx)])

   if (typeof target.increaseCondition === "function") {
      try {
         await target.increaseCondition(slug, _conditionValueOptions(consequence))
         return
      } catch (_err) {}
   }

   const source = condition.toObject()
   delete source._id
   if (_conditionHasValue(slug)) {
      foundry.utils.setProperty(
         source,
         "system.value.value",
         Math.max(1, parseInt(consequence.value) || 1),
      )
   }
   return _createItems(target, [source])
}

async function _removeCondition(consequence, target) {
   const slug = slugify(consequence?.condition)
   if (!slug || !target) return
   if (typeof target.decreaseCondition === "function") {
      try {
         await target.decreaseCondition(slug, { forceRemove: true })
         return
      } catch (_err) {}
   }
   const ids = target.items
      .filter((item) => _itemMatchesSlug(item, slug))
      .map((item) => item.id)
   if (ids.length > 0) await _deleteItems(target, ids)
}

async function _applyEffect(consequence, target) {
   const effect = await _effectFromUuid(consequence?.effectUuid)
   if (!effect) return
   const source = effect.toObject()
   delete source._id
   foundry.utils.setProperty(source, `flags.${MODULE_ID}.isConsequence`, true)
   return _createItems(target, [source])
}

async function _removeEffect(consequence, target) {
   const effect = await _effectFromUuid(consequence?.effectUuid)
   if (!effect || !target) return
   const effectSlug = slugify(effect.system?.slug || effect.slug || effect.name)
   const sourceUuid =
      effect.uuid ||
      effect.sourceId ||
      effect.getFlag?.("core", "sourceId") ||
      effect._stats?.compendiumSource
   const ids = target.items
      .filter((item) => {
         if (item.type !== "effect") return false
         const itemSource =
            item.sourceId ||
            item.getFlag?.("core", "sourceId") ||
            item._stats?.compendiumSource
         return (
            item.uuid === consequence.effectUuid ||
            itemSource === consequence.effectUuid ||
            (sourceUuid && itemSource === sourceUuid) ||
            slugify(item.system?.slug || item.slug || item.name) === effectSlug
         )
      })
      .map((item) => item.id)
   if (ids.length > 0) await _deleteItems(target, ids)
}

async function _applyRuleElement(consequence, target, ctx) {
   const rule = _parseRuleElement(consequence?.ruleJson)
   if (!rule) return
   const actionName = ctx.actionItem?.name || tKey("ActionTab.Consequences")
   const source = {
      name: tKey("Consequences.RuleElementEffectName", { name: actionName }),
      type: "effect",
      img: ctx.actionItem?.img || "icons/svg/aura.svg",
      system: {
         level: { value: 1 },
         duration: _durationData(consequence),
         tokenIcon: { show: true },
         description: {
            value: tKey("Consequences.RuleElementEffectDesc", {
               name: actionName,
            }),
         },
         rules: [rule],
      },
      flags: {
         [MODULE_ID]: {
            isConsequence: true,
            actionUuid: ctx.actionItem?.uuid || null,
         },
      },
   }
   return _createItems(target, [source])
}

async function _confirmConsequence(consequence, targets, ctx) {
   if (!SiegeSettings.promptConsequences()) return true
   const payload = {
      actionName: ctx.actionItem?.name || "",
      actorName: ctx.crewman?.name || game.user.name || "",
      consequenceLabel: _consequenceLabel(consequence),
      targets: targets.map((target) => target.name),
   }
   return SiegeSocketManager.confirmConsequence(payload)
}

async function _rollHpConsequence(consequence, targets, ctx, mode) {
   const formula =
      mode === "heal"
         ? _healFormula(consequence.healParts)
         : _damageFormula(consequence.damageParts)
   if (!formula || formula === "0") return
   if (
      await ConsequenceCardManager.postConsequenceCard({
         mode,
         formula,
         targets,
         actionItem: ctx.actionItem,
         crewman: ctx.crewman,
      })
   )
      return
   await _withTemporaryTargets(targets, async () => {
      const roll = await _evaluateDamageRoll(formula)
      await _postHpConsequenceRoll({
         roll,
         targets,
         mode,
         actionItem: ctx.actionItem,
         crewman: ctx.crewman,
      })
   })
}

function _consequenceLabel(consequence) {
   const type = consequence?.type || ""
   if (type === "apply-condition")
      return tKey("Consequences.ApplyConditionLabel", {
         name: _conditionDocument(slugify(consequence.condition))?.name ||
            capitalize(slugify(consequence.condition)),
      })
   if (type === "remove-condition")
      return tKey("Consequences.RemoveConditionLabel", {
         name: _conditionDocument(slugify(consequence.condition))?.name ||
            capitalize(slugify(consequence.condition)),
      })
   if (type === "apply-effect" || type === "remove-effect")
      return tKey(
         type === "apply-effect"
            ? "ActionTab.ApplyEffect"
            : "ActionTab.RemoveEffect",
      )
   if (type === "apply-rule-element") return tKey("ActionTab.ApplyRuleElement")
   return type
}

function _damageRollClass() {
   return (
      CONFIG?.Dice?.rolls?.find?.((cls) => cls.name === "DamageRoll") ||
      globalThis.DamageRoll ||
      Roll
   )
}

async function _evaluateDamageRoll(formula) {
   const RollCls = _damageRollClass()
   try {
      return await new RollCls(formula).evaluate()
   } catch (err) {
      if (RollCls === Roll) throw err
      return new Roll(_stripDamageTags(formula)).evaluate()
   }
}

async function _withTemporaryTargets(targets, fn) {
   const next = new Set(_tokensForTargets(targets))
   if (next.size === 0) return fn()

   const previous = new Set(game.user.targets)
   for (const token of previous) {
      if (!next.has(token)) token.setTarget(false, { user: game.user })
   }
   for (const token of next) {
      token.setTarget(true, {
         user: game.user,
         releaseOthers: false,
         groupSelection: true,
      })
   }

   try {
      return await fn()
   } finally {
      for (const token of next) {
         if (!previous.has(token)) token.setTarget(false, { user: game.user })
      }
      for (const token of previous) {
         token.setTarget(true, {
            user: game.user,
            releaseOthers: false,
            groupSelection: true,
         })
      }
   }
}

function _tokensForTargets(targets) {
   const tokens = []
   for (const actor of targets) {
      const active = actor?.getActiveTokens?.()[0]
      const token =
         active?.setTarget ? active : active?.id ? canvas?.tokens?.get(active.id) : null
      if (token?.setTarget) tokens.push(token)
   }
   return tokens
}

async function _postHpConsequenceRoll({
   roll,
   targets,
   mode,
   actionItem,
   crewman,
} = {}) {
   const targetNames = targets.map((target) => target.name).join(", ")
   const kind = mode === "heal" ? tKey("Consequences.Healing") : tKey("Consequences.Damage")
   const title = actionItem?.name
      ? `${actionItem.name} ${tKey("ActionTab.Consequences")}`
      : tKey("ActionTab.Consequences")
   const content = await renderHbs(tplPath("macros/consequence-roll-flavor.hbs"), {
      title,
      kind,
      targets: targetNames,
   })
   await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: crewman || targets[0] }),
      flavor: content,
      flags: {
         [MODULE_ID]: {
            isConsequenceDamageRoll: mode === "damage",
            isConsequenceHealingRoll: mode === "heal",
            targetActorUuids: targets.map((target) => target.uuid),
         },
      },
   })
}

function _conditionDocument(slug) {
   try {
      return game.pf2e?.ConditionManager?.getCondition?.(slug) || null
   } catch (_err) {
      return null
   }
}

function _conditionHasValue(slug) {
   const doc = _conditionDocument(slug)
   const systemValue = doc?.system?.value
   if (systemValue?.isValued === true) return true
   if (Number.isFinite(Number(systemValue?.value))) return true
   return [
      "clumsy",
      "doomed",
      "drained",
      "dying",
      "enfeebled",
      "frightened",
      "persistent-damage",
      "sickened",
      "slowed",
      "stunned",
      "stupefied",
      "wounded",
   ].includes(slug)
}

function _conditionValueOptions(consequence) {
   const slug = slugify(consequence?.condition)
   if (!_conditionHasValue(slug)) return {}
   return { value: Math.max(1, parseInt(consequence.value) || 1) }
}

function _conditionEffectSource(consequence, condition, ctx) {
   const slug = slugify(consequence?.condition)
   const grant = {
      key: "GrantItem",
      uuid: condition.uuid || condition.sourceId,
   }
   if (_conditionHasValue(slug)) {
      grant.alterations = [
         {
            mode: "override",
            property: "system.value.value",
            value: Math.max(1, parseInt(consequence.value) || 1),
         },
      ]
   }
   return {
      name: tKey("Consequences.ConditionEffectName", {
         name: condition.name || capitalize(slug),
      }),
      type: "effect",
      img: condition.img || "systems/pf2e/icons/default-icons/condition.svg",
      system: {
         level: { value: 1 },
         duration: _durationData(consequence),
         tokenIcon: { show: true },
         description: {
            value: tKey("Consequences.ConditionEffectDesc", {
               action: ctx.actionItem?.name || "",
               condition: condition.name || capitalize(slug),
            }),
         },
         rules: [grant],
      },
      flags: {
         [MODULE_ID]: {
            isConsequence: true,
            actionUuid: ctx.actionItem?.uuid || null,
            condition: slug,
         },
      },
   }
}

function _durationData(consequence) {
   if (!consequence?.hasDuration)
      return {
         value: -1,
         unit: "unlimited",
         sustained: false,
         expiry: null,
      }
   return {
      value: Math.max(1, parseInt(consequence.durationValue) || 1),
      unit: consequence.durationUnit || "rounds",
      sustained: false,
      expiry: "turn-start",
   }
}

async function _effectFromUuid(uuid) {
   if (!uuid) {
      ui.notifications.warn(tKey("ActionTab.NoEffectUUID"))
      return null
   }
   const doc = await fromUuid(uuid).catch(() => null)
   if (doc?.documentName === "Item" && doc.type === "effect") return doc
   ui.notifications.warn(tKey("ActionTab.InvalidUUID"))
   return null
}

function _parseRuleElement(text) {
   try {
      const parsed = JSON.parse(text || "")
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
         throw new Error("Rule Element must be an object")
      if (typeof parsed.key !== "string" || parsed.key.trim() === "")
         throw new Error("Rule Element is missing key")
      return parsed
   } catch (_err) {
      ui.notifications.warn(tKey("ActionTab.InvalidRuleElement"))
      return null
   }
}

function _damageFormula(parts = []) {
   return _cleanParts(parts)
      .map((part) => {
         const faces = part.die === "-" ? "" : part.die
         const base = faces ? `${part.dice}${faces}` : `${part.dice}`
         const tags = [part.type]
         if (part.category && part.category !== "normal")
            tags.push(part.category)
         return `${base}[${tags.join(",")}]`
      })
      .filter((term) => !term.startsWith("0["))
      .join(" + ") || "0"
}

function _healFormula(parts = []) {
   const terms = []
   for (const part of _cleanHealParts(parts)) {
      const faces = part.die === "-" ? "" : part.die
      if (part.dice > 0)
         terms.push(`${faces ? `${part.dice}${faces}` : `${part.dice}`}[healing]`)
      if (part.bonus) terms.push(`${part.bonus}[healing]`)
   }
   return terms.join(" + ") || "0"
}

function _stripDamageTags(formula) {
   return String(formula || "").replace(/\[[^\]]+\]/g, "")
}

function _cleanParts(parts = []) {
   const source = Array.isArray(parts) ? parts : []
   return source.map((part) => ({
      dice: Math.max(0, parseInt(part?.dice) || 0),
      die: DIE_SIZES.includes(part?.die) ? part.die : "d6",
      type: PF2E_DAMAGE_TYPES.includes(part?.type) ? part.type : "untyped",
      category: DAMAGE_CATEGORIES.includes(part?.category)
         ? part.category
         : "normal",
   }))
}

function _cleanHealParts(parts = []) {
   const source = Array.isArray(parts) ? parts : []
   return source.map((part) => ({
      dice: Math.max(0, parseInt(part?.dice) || 0),
      die: DIE_SIZES.includes(part?.die) ? part.die : "d6",
      bonus: parseInt(part?.bonus) || 0,
   }))
}

async function _createItems(actor, items) {
   if (!actor || !items?.length) return
   return SiegeSocketManager.modifySiegeItem(actor.uuid, "create", items, {
      render: false,
      siegeConsequence: true,
   })
}

async function _deleteItems(actor, ids) {
   if (!actor || !ids?.length) return
   return SiegeSocketManager.modifySiegeItem(actor.uuid, "delete", ids, {
      render: false,
      siegeConsequence: true,
   })
}

function _itemMatchesSlug(item, slug) {
   return (
      slugify(item.system?.slug || item.slug || item.name) === slug ||
      slugify(item.name) === slug
   )
}
