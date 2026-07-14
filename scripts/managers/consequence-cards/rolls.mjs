import {
   DAMAGE_CATEGORIES,
   DIE_SIZES,
   PF2E_DAMAGE_TYPES,
} from "../../constants.mjs"
import { tKey } from "../../utils.mjs"
import { resolveActionDC } from "../../macros/helpers.mjs"
import { capitalizeDamageType, staticMethods } from "./helpers.mjs"

class ConsequenceCardRollMixin {
   static _resolveSaveDC(value, actor) {
      return resolveActionDC(actor, value, 10)
   }

   static _outcomeFromRoll(roll, callbackOutcome = null) {
      if (typeof callbackOutcome === "string") return callbackOutcome
      const callbackDos =
         callbackOutcome?.degreeOfSuccess?.value ??
         callbackOutcome?.degreeOfSuccess ??
         callbackOutcome?.degree
      let dos =
         callbackDos ??
         roll.degreeOfSuccess?.value ??
         roll.degreeOfSuccess ??
         1
      if (callbackOutcome?.outcome) return callbackOutcome.outcome
      if (callbackOutcome?.options?.outcome) return callbackOutcome.options.outcome
      const d20 =
         roll.dice?.find?.((die) => Number(die.faces) === 20)?.total ??
         roll.terms?.find?.((term) => Number(term.faces) === 20)?.total
      if (d20 === 20) dos = 3
      else if (d20 === 1) dos = 0
      return {
         0: "criticalFailure",
         1: "failure",
         2: "success",
         3: "criticalSuccess",
      }[dos] || "failure"
   }

   static _renderSaveResult(control, roll, outcome, d20 = null) {
      const row = control.closest(".target-row")
      const normalizedClass = this._outcomeClass(outcome)
      if (row) {
         row.dataset.rolled = "true"
         row.dataset.outcome = normalizedClass
         row.classList.toggle(
            "crit-success-row",
            normalizedClass === "critical-success",
         )
      }
      const degree = control.querySelector(".degree")
      if (degree) {
         const label = this._outcomeLabel(outcome)
         degree.textContent = String(roll.total ?? "")
         degree.classList.remove(
            "hidden",
            "nat20",
            "nat1",
            "critical-success",
            "success",
            "failure",
            "critical-failure",
            "criticalSuccess",
            "criticalFailure",
         )
         degree.classList.add("show", normalizedClass)
         degree.style.color = this._outcomeResultColor(outcome, d20)
         degree.title = label
         degree.dataset.tooltip = label
         if (d20 === 20) degree.classList.add("nat20")
         else if (d20 === 1) degree.classList.add("nat1")
      }
      control.classList.remove("roll")
      control.classList.add("reroll")
      control.dataset.action = "reroll-save"
      control.title = this._outcomeLabel(outcome)
      control.dataset.tooltip = this._saveTooltip({
         saveLabel: this._saveLabel(control.dataset.statistic || "reflex"),
         dc: control.dataset.dc,
         roll,
         outcome,
         d20,
      })
      control.querySelector(".die")?.classList.add("hidden")

      if (row) row.classList.remove("applied")
      const consequenceList = row?.querySelector(".siege-save-consequence-list")
      if (consequenceList) {
         consequenceList.innerHTML = ""
         consequenceList.classList.add("hidden")
      }
   }

   static _outcomeClass(outcome) {
      return {
         criticalSuccess: "critical-success",
         "critical-success": "critical-success",
         success: "success",
         failure: "failure",
         criticalFailure: "critical-failure",
         "critical-failure": "critical-failure",
      }[outcome] || "failure"
   }

   static _normalizeOutcome(value) {
      if (value == null) return null
      if (typeof value === "number")
         return {
            0: "criticalFailure",
            1: "failure",
            2: "success",
            3: "criticalSuccess",
         }[value] || null
      const key = String(value).trim()
      return (
         {
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
         }[key] ||
         {
            "critical success": "criticalSuccess",
            "critical failure": "criticalFailure",
            "no roll": "no-roll",
         }[key.toLowerCase()] ||
         null
      )
   }

   static _outcomeLabel(outcome) {
      return (
         {
            criticalSuccess: tKey("ActionTab.CriticalSuccess"),
            success: tKey("ActionTab.Success"),
            failure: tKey("ActionTab.Failure"),
            criticalFailure: tKey("ActionTab.CriticalFailure"),
            "critical-success": tKey("ActionTab.CriticalSuccess"),
            "critical-failure": tKey("ActionTab.CriticalFailure"),
         }[outcome] || capitalizeDamageType(outcome)
      )
   }

   static _outcomeColor(outcome) {
      return (
         {
            criticalSuccess: "#15803d",
            success: "#287a31",
            failure: "#b45309",
            criticalFailure: "#b91c1c",
            "critical-success": "#15803d",
            "critical-failure": "#b91c1c",
         }[outcome] || "var(--color-text-primary, currentColor)"
      )
   }

   static _outcomeResultColor(outcome, d20 = null) {
      if (Number(d20) === 20) return "var(--color-text-success, #18520b)"
      if (Number(d20) === 1) return "var(--color-text-error, #b81a1a)"
      return this._outcomeColor(outcome)
   }

   static _saveLabel(save) {
      return (
         {
            fortitude: tKey("Fields.Fortitude"),
            reflex: tKey("Fields.Reflex"),
            will: tKey("Fields.Will"),
         }[save] || capitalizeDamageType(save || "save")
      )
   }

   static _saveIcon(save) {
      return (
         {
            fortitude: "fa-shield-heart",
            reflex: "fa-person-running",
            will: "fa-brain",
         }[save] || "fa-shield-halved"
      )
   }

   static _saveTooltip({ saveLabel, dc, roll = null, outcome = null, d20 = null } = {}) {
      const lines = [
         `<div>${this._escape(tKey("Consequences.SaveTooltipTitle", {
            save: saveLabel || tKey("ActionTab.SavingThrow"),
            dc: dc ?? "",
         }))}</div>`,
      ]
      if (roll) {
         const diff = Number(roll.total) - Number(dc)
         const diffText = Number.isFinite(diff)
            ? `${diff >= 0 ? "+" : ""}${diff}`
            : ""
         lines.push(
            `<div class="result">${this._escape(tKey("Consequences.SaveTooltipResult"))}: (<i class="fa-solid fa-dice-d20"></i> ${this._escape(d20 ?? "")}) ${this._escape(this._outcomeLabel(outcome))}${diffText ? ` ${this._escape(tKey("Consequences.SaveTooltipBy", { diff: diffText }))}` : ""}</div>`,
         )
         lines.push(
            `<div class="note"><i class="fa-solid fa-rotate rotate"></i> ${this._escape(tKey("Consequences.SaveTooltipReroll"))}</div>`,
         )
      }
      return `<div class="pf2e-toolbelt-target-save">${lines.join("")}</div>`
   }

   static _d20TotalFromRoll(roll) {
      const dice = Array.isArray(roll?.dice) ? roll.dice : []
      const die = dice.find((candidate) => Number(candidate?.faces) === 20)
      if (die) {
         const total = Number(die.total)
         if (Number.isFinite(total)) return total
         const result = die.results?.find?.((entry) => entry.active !== false)
         const value = Number(result?.result)
         if (Number.isFinite(value)) return value
      }
      const term = roll?.terms?.find?.((candidate) => Number(candidate?.faces) === 20)
      const termTotal = Number(term?.total)
      return Number.isFinite(termTotal) ? termTotal : null
   }

   static async _presentCardRoll(roll) {
      try {
         await game.dice3d?.showForRoll?.(roll, game.user, true)
      } catch (_err) {}
      try {
         CONFIG.sounds?.dice && foundry.audio.AudioHelper.play(
            { src: CONFIG.sounds.dice, volume: 0.8 },
            true,
         )
      } catch (_err) {}
   }

   static _heroPointActor(actor) {
      return actor?.isOfType?.("familiar") ? actor.master : actor
   }

   static _heroPointPath(actor) {
      const source = this._heroPointActor(actor)
      const candidates = [
         "system.resources.heroPoints.value",
         "system.resources.hero.value",
         "system.heroPoints.value",
         "system.attributes.heroPoints.value",
      ]
      for (const path of candidates) {
         const value = Number(foundry.utils.getProperty(source, path))
         if (Number.isFinite(value)) return path
      }
      return null
   }

   static _hasHeroPoint(actor) {
      const source = this._heroPointActor(actor)
      const path = this._heroPointPath(source)
      const current = Number(path ? foundry.utils.getProperty(source, path) : NaN)
      if (path && Number.isFinite(current) && current > 0) return true
      ui.notifications.warn(
         tKey("Notifications.NoHeroPoints", {
            name: source?.name ?? tKey("Actor.ThisActor"),
         }),
      )
      return false
   }

   static async _spendHeroPoint(actor) {
      const source = this._heroPointActor(actor)
      const path = this._heroPointPath(source)
      const current = Number(path ? foundry.utils.getProperty(source, path) : NaN)
      if (!path || !Number.isFinite(current) || current <= 0) {
         ui.notifications.warn(
            tKey("Notifications.NoHeroPoints", {
               name: source?.name ?? tKey("Actor.ThisActor"),
            }),
         )
         return false
      }
      try {
         await source.update({ [path]: Math.max(0, current - 1) })
         return true
      } catch (_err) {
         ui.notifications.warn(tKey("Notifications.HeroPointSpendFailed"))
         return false
      }
   }

   static async _rollSaveHpConsequences(consequence) {
      const nested = Array.isArray(consequence?.consequences)
         ? consequence.consequences
         : []
      const entries = []
      for (let index = 0; index < nested.length; index++) {
         const child = nested[index]
         if (!["deal-damage", "heal"].includes(child?.type)) continue
         const mode = child.type === "heal" ? "heal" : "damage"
         const formula =
            mode === "heal"
               ? this._healFormula(child.healParts)
               : this._damageFormula(child.damageParts)
         if (!formula || formula === "0") continue
         const outcome =
            this._normalizeOutcome(child.outcome) || "failure"
         entries.push({
            key: `hp-${index}`,
            index,
            mode,
            outcome,
            formula,
            title:
               mode === "heal"
                  ? tKey("Consequences.CardHealing")
                  : tKey("Consequences.CardDamage"),
         })
      }
      return entries
   }

   static async _rollBasicSaveDamage(consequence) {
      if (!consequence?.basicSave) return null
      const formula = this._damageFormula(consequence.basicDamageParts)
      if (!formula || formula === "0") return null
      return this._rollFormula(formula)
   }

   static async _renderTargetHpConsequences({
      data,
      row,
      outcome,
      targetUuid,
   } = {}) {
      if (!data || !row || !targetUuid) return
      const list = row.querySelector(".siege-save-consequence-list")
      if (!list) return
      const normalizedClass = this._outcomeClass(outcome)
      const targetRolls = {}
      const html = []

      if (data.basicDamageRoll) {
         const multiplier = this._basicSaveMultiplier(outcome)
         html.push(
            this._renderBasicSaveApplication(
               data.basicDamageRoll,
               multiplier,
               outcome,
            ),
         )
         targetRolls.basic = {
            key: "basic",
            mode: "damage",
            rollData: data.basicDamageRoll,
            multiplier,
         }
      }

      const hpRolls = Array.isArray(data.hpRolls) ? data.hpRolls : []
      for (const entry of hpRolls) {
         if (this._outcomeClass(entry.outcome) !== normalizedClass) continue
         const rollData = await this._rollFormula(entry.formula)
         const rolledEntry = {
            ...entry,
            rollData,
         }
         html.push(this._renderSaveHpConsequence(rolledEntry))
         targetRolls[entry.key] = {
            key: entry.key,
            mode: entry.mode,
            rollData,
         }
      }

      list.innerHTML = html.join("")
      list.classList.toggle("hidden", html.length === 0)
      data.targetHpRolls = foundry.utils.deepClone(data.targetHpRolls || {})
      data.targetHpRolls[targetUuid] = targetRolls
   }

   static _basicSaveMultiplier(outcome) {
      return (
         {
            criticalSuccess: 0,
            "critical-success": 0,
            success: 0.5,
            failure: 1,
            criticalFailure: 2,
            "critical-failure": 2,
         }[outcome] ?? 1
      )
   }

   static _hpRollForControl(data, control, targetUuid = null) {
      if (control.dataset.basicDamage === "true")
         return data?.basicDamageRoll
            ? {
                 mode: "damage",
                 rollData: data.basicDamageRoll,
              }
            : null
      const key = control.dataset.hpKey
      if (!key || !targetUuid) return null
      return data?.targetHpRolls?.[targetUuid]?.[key] || null
   }

   static async _ensureCardHpRoll({
      data,
      control,
      targetUuid,
      card,
   } = {}) {
      const existing = this._hpRollForControl(data, control, targetUuid)
      if (existing) return existing
      if (!data || data.mode === "save" || !data.formula || !targetUuid) return null

      const mode = data.mode === "heal" ? "heal" : "damage"
      const rollData = await this._rollFormula(data.formula)
      const entry = {
         key: "primary",
         mode,
         rollData,
      }
      data.targetHpRolls = foundry.utils.deepClone(data.targetHpRolls || {})
      data.targetHpRolls[targetUuid] = {
         ...(data.targetHpRolls[targetUuid] || {}),
         primary: entry,
      }

      const row = control.closest(".target-row")
      const slot = row?.querySelector(".siege-target-roll-slot")
      if (slot) {
         slot.innerHTML = this._renderRollBlock(
            rollData,
            mode === "heal"
               ? tKey("Consequences.CardHealing")
               : tKey("Consequences.CardDamage"),
         )
      }
      await this._persistCardContent(card, { cardData: data })
      return entry
   }

   static _damageFormula(parts = []) {
      return (
         this._cleanParts(parts)
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
      )
   }

   static _healFormula(parts = []) {
      const terms = []
      for (const part of this._cleanHealParts(parts)) {
         const faces = part.die === "-" ? "" : part.die
         if (part.dice > 0)
            terms.push(`${faces ? `${part.dice}${faces}` : `${part.dice}`}[healing]`)
         if (part.bonus) terms.push(`${part.bonus}[healing]`)
      }
      return terms.join(" + ") || "0"
   }

   static _cleanParts(parts = []) {
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

   static _cleanHealParts(parts = []) {
      const source = Array.isArray(parts) ? parts : []
      return source.map((part) => ({
         dice: Math.max(0, parseInt(part?.dice) || 0),
         die: DIE_SIZES.includes(part?.die) ? part.die : "d6",
         bonus: parseInt(part?.bonus) || 0,
      }))
   }

   static _stripDamageTags(formula) {
      return String(formula || "").replace(/\[[^\]]+\]/g, "")
   }
}

export const consequenceCardRollMethods = staticMethods(ConsequenceCardRollMixin)
