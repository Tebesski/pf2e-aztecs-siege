import {
   DAMAGE_COLOR_MAP,
   DAMAGE_ICON_MAP,
} from "../../constants.mjs"
import { renderHbs, tKey, tplPath } from "../../utils.mjs"
import { capitalizeDamageType, staticMethods } from "./helpers.mjs"

class ConsequenceCardRenderMixin {
   static async _renderCard({ mode, formula, tokenDocs, actionItem }) {
      const title =
         mode === "heal"
            ? tKey("Consequences.CardHealing")
            : tKey("Consequences.CardDamage")
      const fallbackTitle = tKey("ActionTab.Consequences")
      return renderHbs(tplPath("chat/consequence-card.hbs"), {
         mode,
         cardClass: mode === "heal" ? "atw-heal-card" : "atw-damage-card",
         headerIcon: this._renderHeaderIcon(
            actionItem?.img || "icons/svg/d20.svg",
            actionItem?.name || fallbackTitle,
         ),
         title: actionItem?.name || fallbackTitle,
         formulaSummary: this._renderFormulaSummary(formula, title),
         targetRows: tokenDocs
            .map((doc) => this._renderTargetRow(doc, mode))
            .join(""),
      })
   }

   static _renderFormulaSummary(formula, title) {
      return `<section class="atw-mtcard-damage card-content siege-consequence-damage-block siege-consequence-formula-summary">
           <div style="font-weight:700;padding-bottom:4px;border-bottom:1px solid rgba(0,0,0,0.15);margin-bottom:4px;font-size:1.05em">${this._escape(title)}</div>
           <div class="dice-formula" style="background:transparent;border:none;box-shadow:none;padding:0;text-align:left">
             ${this._renderFormulaSummaryRows(formula)}
           </div>
         </section>`
   }

   static _renderFormulaSummaryRows(formula) {
      const parts = this._splitFormulaParts(formula)
      if (parts.length === 0)
         return `<span style="font-weight:600">${this._escape(formula || "")}</span>`

      return parts
         .map((part) => {
            const match = String(part).match(/^\s*(.*?)\s*(?:\[([^\]]+)\])?\s*$/)
            const cleanFormula = this._stripDamageTags(match?.[1] || part).trim()
            const tags = String(match?.[2] || "")
               .split(",")
               .map((tag) => tag.trim().toLowerCase())
               .filter(Boolean)
            const type =
               tags.includes("healing") ||
               tags.includes("healing-received") ||
               tags.includes("healing-receive")
                  ? "healing"
                  : tags.find((tag) => DAMAGE_ICON_MAP[tag]) || "untyped"
            const icon =
               type === "healing"
                  ? "fa-heart"
                  : DAMAGE_ICON_MAP[type] || DAMAGE_ICON_MAP.untyped
            const color =
               type === "healing"
                  ? "#4f9f5e"
                  : DAMAGE_COLOR_MAP[type] || DAMAGE_COLOR_MAP.untyped
            return `<div style="display:flex;align-items:center;margin-bottom:2px;gap:6px">
                 <span>
                   <i class="fa-solid ${this._escape(icon)}" style="color:${this._escape(color)};margin-right:4px"></i>
                   <span style="font-weight:600">${this._escape(cleanFormula || part)}</span>
                   <span style="text-transform:capitalize;margin-left:2px">${this._escape(type)}</span>
                 </span>
               </div>`
         })
         .join("")
   }

   static _splitFormulaParts(formula) {
      const value = String(formula || "").trim()
      if (!value) return []
      const parts = []
      let current = ""
      let bracketDepth = 0
      for (let index = 0; index < value.length; index++) {
         const char = value[index]
         if (char === "[") bracketDepth++
         if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1)
         const isTopLevelSeparator =
            bracketDepth === 0 &&
            (char === "," ||
               (char === "+" &&
                  /\s/.test(value[index - 1] || "") &&
                  /\s/.test(value[index + 1] || "")))
         if (isTopLevelSeparator) {
            if (current.trim()) parts.push(current.trim())
            current = ""
            continue
         }
         current += char
      }
      if (current.trim()) parts.push(current.trim())
      return parts
   }

   static _renderHeaderIcon(src, alt) {
      return `<div class="aztec-icon-wrapper aztec-global-inset-common" style="display:block;flex:0 0 2.2em;width:2.2em;min-width:2.2em;max-width:2.2em;height:2.2em;min-height:2.2em;max-height:2.2em;margin:1px 8px 1px 2px;border-radius:4px;position:relative;box-sizing:border-box"><img src="${this._escape(src)}" alt="${this._escape(alt)}" style="width:100%;height:100%;max-width:100%;max-height:100%;margin:0;padding:0;border:none;display:block;object-fit:cover;border-radius:2px"></div>`
   }

   static _renderSharedDamageBlock(rollData, title = tKey("Consequences.CardDamageShort")) {
      const instances = Array.isArray(rollData?.instances)
         ? rollData.instances
         : []
      const rows = instances
         .map((instance) => {
            const type = instance.type || "untyped"
            const icon =
               type === "healing"
                  ? "fa-heart"
                  : DAMAGE_ICON_MAP[type] || DAMAGE_ICON_MAP.untyped
            const color =
               type === "healing"
                  ? "#4f9f5e"
                  : DAMAGE_COLOR_MAP[type] || DAMAGE_COLOR_MAP.untyped
            const formula = String(instance.formula || rollData?.formula || "")
            const total = String(instance.total ?? "")
            const isFlat = !/[dD+\-*/]/.test(formula)
            const showTotal = !isFlat && formula.trim() !== total.trim()
            return `<div style="display:flex;align-items:center;margin-bottom:2px;gap:6px">
                 <span>
                   <i class="fa-solid ${this._escape(icon)}" style="color:${this._escape(color)};margin-right:4px"></i>
                   <span style="font-weight:600">${this._escape(formula)}</span>
                   <span style="text-transform:capitalize;margin-left:2px">${this._escape(type)}</span>
                 </span>
                 ${showTotal ? `<span style="font-weight:bold">= ${this._escape(total)}</span>` : ""}
               </div>`
         })
         .join("")
      return `<section class="atw-mtcard-damage card-content siege-consequence-damage-block">
           <div style="font-weight:700;padding-bottom:4px;border-bottom:1px solid rgba(0,0,0,0.15);margin-bottom:4px;font-size:1.05em">${this._escape(title)}</div>
           <div class="dice-formula" style="background:transparent;border:none;box-shadow:none;padding:0;text-align:left">
             ${rows}
             <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(0,0,0,0.15)">
               <span style="color:var(--rnt-accent, #c34);font-weight:bold;font-size:1.15em">${this._escape(tKey("Consequences.CardTotal", { total: rollData?.total ?? 0 }))}</span>
             </div>
           </div>
         </section>`
   }

   static _renderSaveHpButtons(entry) {
      const action = entry.mode === "heal" ? "heal" : "damage"
      const primary =
         entry.mode === "heal"
            ? tKey("Consequences.CardApplyHealing")
            : tKey("Consequences.CardApplyDamage")
      const icon = entry.mode === "heal" ? "fa-heart" : "fa-heart-crack"
      const outcome = this._outcomeClass(entry.outcome)
      const data =
         `data-hp-key="${this._escape(entry.key)}" data-hp-outcome="${this._escape(outcome)}"`
      return `<button type="button" class="siege-save-hp-button" data-siege-consequence-action="${this._escape(action)}" ${data} data-multiplier="1" data-action="${action === "heal" ? "target-applyHealing" : "target-applyDamage"}">
               <i class="fa-solid ${this._escape(icon)} fa-fw"></i><span class="label">${this._escape(primary)}</span>
            </button>
            <button type="button" class="half-damage siege-save-hp-button" data-siege-consequence-action="${this._escape(action)}" ${data} data-multiplier="0.5" data-action="${action === "heal" ? "target-applyHealing" : "target-applyDamage"}">
               <i class="fa-solid ${this._escape(icon)} fa-fw"></i><span class="label">${this._escape(tKey("Consequences.CardHalf"))}</span>
            </button>
            <button type="button" class="siege-save-hp-button" data-siege-consequence-action="${this._escape(action)}" ${data} data-multiplier="2" data-action="${action === "heal" ? "target-applyHealing" : "target-applyDamage"}">
               <img src="systems/pf2e/icons/damage/double.svg"><span class="label">${this._escape(tKey("Consequences.CardDouble"))}</span>
            </button>`
   }

   static _renderSaveHpConsequence(entry) {
      if (!entry?.rollData) return ""
      return `<div class="siege-save-hp-consequence" data-hp-key="${this._escape(entry.key)}" data-hp-outcome="${this._escape(this._outcomeClass(entry.outcome))}">
         ${this._renderSharedDamageBlock(entry.rollData, entry.title)}
         <section class="damage-application small atw-mtcard-apply siege-consequence-application" data-hp-key="${this._escape(entry.key)}" style="transition: filter 0.3s;">
            ${this._renderSaveHpButtons(entry)}
         </section>
      </div>`
   }

   static _renderBasicSaveApplication(rollData, multiplier, outcome) {
      const outcomeClass = this._outcomeClass(outcome)
      const toolbeltOutcomeClass = this._toolbeltOutcomeClass(outcome)
      const applicationClass =
         Number(multiplier) > 0
            ? ` ${this._escape(outcomeClass)} ${this._escape(toolbeltOutcomeClass)}`
            : ""
      const outcomeData =
         Number(multiplier) > 0
            ? ` data-outcome="${this._escape(outcomeClass)}"`
            : ""
      return `<div class="siege-save-hp-consequence siege-basic-save-consequence" data-hp-key="basic" data-hp-outcome="${this._escape(this._outcomeClass(outcome))}">
         <section class="damage-application small atw-mtcard-apply siege-consequence-application${applicationClass}" data-hp-key="basic"${outcomeData} style="transition: filter 0.3s;">
            <button type="button" data-siege-consequence-action="damage" data-basic-damage="true" data-hp-key="basic" data-multiplier="1" data-action="target-applyDamage">
               <i class="fa-solid fa-heart-crack fa-fw"></i><span class="label">${this._escape(tKey("Consequences.CardApplyDamage"))}</span>
            </button>
            <button type="button" class="half-damage" data-siege-consequence-action="damage" data-basic-damage="true" data-hp-key="basic" data-multiplier="0.5" data-action="target-applyDamage">
               <i class="fa-solid fa-heart-crack fa-fw"></i><span class="label">${this._escape(tKey("Consequences.CardHalf"))}</span>
            </button>
            <button type="button" data-siege-consequence-action="damage" data-basic-damage="true" data-hp-key="basic" data-multiplier="2" data-action="target-applyDamage">
               <img src="systems/pf2e/icons/damage/double.svg"><span class="label">${this._escape(tKey("Consequences.CardDouble"))}</span>
            </button>
         </section>
      </div>`
   }

   static _toolbeltOutcomeClass(outcome) {
      return (
         {
            criticalSuccess: "criticalSuccess",
            "critical-success": "criticalSuccess",
            success: "success",
            failure: "failure",
            criticalFailure: "criticalFailure",
            "critical-failure": "criticalFailure",
         }[outcome] || this._outcomeClass(outcome)
      )
   }

   static _renderRollBlock(rollData, title) {
      const instanceHtml = rollData.instances
         .map((instance) => {
            const type = instance.type || "untyped"
            const icon =
               type === "healing"
                  ? "fa-heart"
                  : DAMAGE_ICON_MAP[type] || DAMAGE_ICON_MAP.untyped
            const color =
               type === "healing"
                  ? "#4f9f5e"
                  : DAMAGE_COLOR_MAP[type] || DAMAGE_COLOR_MAP.untyped
            return `<span class="${this._escape(type)} damage instance color siege-consequence-instance" data-tooltip="${this._escape(capitalizeDamageType(type))}" style="--siege-consequence-color:${this._escape(color)}">
               ${this._escape(instance.formula || rollData.formula)}
               <i class="fa-solid ${this._escape(icon)} icon"></i>
            </span>`
         })
         .join("")
      return `<section class="dice-roll damage-roll siege-consequence-roll" data-siege-consequence-action="expand-roll" data-tooltip-class="pf2e">
         <div class="dice-result">
            <div class="dice-formula">${instanceHtml}</div>
            ${this._renderDiceTooltip(rollData)}
            <h4 class="dice-total">
               <span class="total" data-tooltip-direction="LEFT">${this._escape(rollData.total)}</span>
            </h4>
         </div>
         <p class="siege-consequence-roll-title">${this._escape(title)}</p>
      </section>`
   }

   static _renderTargetRow(tokenDoc, mode) {
      const actor = tokenDoc.actor
      const name = actor?.name || tokenDoc.name || ""
      const primary =
         mode === "heal"
            ? tKey("Consequences.CardApplyHealing")
            : tKey("Consequences.CardApplyDamage")
      return `<div class="target-row siege-consequence-target-row"
            data-target-uuid="${this._escape(tokenDoc.uuid)}"
            data-rolled="true"
            style="transition: filter 0.3s;">
         <hr>
          <div class="target-header">
             <span class="name">
                <i class="fa-solid fa-person"></i>
                ${this._escape(name)}
             </span>
          </div>
          <div class="siege-target-roll-slot"></div>
          <section class="damage-application small atw-mtcard-apply siege-consequence-application" data-target-uuid="${this._escape(tokenDoc.uuid)}" style="transition: filter 0.3s;">
             <button type="button" data-siege-consequence-action="${mode === "heal" ? "heal" : "damage"}" data-hp-key="primary" data-multiplier="1" data-action="target-applyDamage">
                <i class="fa-solid ${mode === "heal" ? "fa-heart" : "fa-heart-crack"} fa-fw"></i>
                <span class="label">${this._escape(primary)}</span>
             </button>
             <button type="button" class="half-damage" data-siege-consequence-action="${mode === "heal" ? "heal" : "damage"}" data-hp-key="primary" data-multiplier="0.5" data-action="target-applyDamage">
                <i class="fa-solid ${mode === "heal" ? "fa-heart" : "fa-heart-crack"} fa-fw"></i>
                <span class="label">${this._escape(tKey("Consequences.CardHalf"))}</span>
             </button>
             <button type="button" data-siege-consequence-action="${mode === "heal" ? "heal" : "damage"}" data-hp-key="primary" data-multiplier="2" data-action="target-applyDamage">
                <img src="systems/pf2e/icons/damage/double.svg">
                <span class="label">${this._escape(tKey("Consequences.CardDouble"))}</span>
             </button>
         </section>
      </div>`
   }

   static async _renderSaveCard({
      consequence,
      hpRolls = [],
      basicDamageRoll = null,
      tokenDocs,
      actionItem,
      dc,
   }) {
      const save = consequence.save || "reflex"
      const saveLabel = this._saveLabel(save)
      const fallbackTitle = tKey("ActionTab.Consequences")
      return renderHbs(tplPath("chat/consequence-save-card.hbs"), {
         headerIcon: this._renderHeaderIcon(
            actionItem?.img || "icons/svg/d20.svg",
            actionItem?.name || fallbackTitle,
         ),
         title: actionItem?.name || fallbackTitle,
         defenseLabel: tKey("Consequences.CardDefense"),
         basicLabel: tKey("Consequences.CardBasic"),
         basicSave: !!consequence.basicSave,
         saveLabel,
         dcLabel: tKey("Consequences.CardDC"),
         dc,
         basicDamageBlock: basicDamageRoll
            ? this._renderSharedDamageBlock(
                 basicDamageRoll,
                 tKey("ActionTab.BasicDamage"),
              )
            : "",
         targetRows: tokenDocs
            .map((doc) => this._renderSaveTargetRow(doc, consequence, dc, hpRolls))
            .join(""),
      })
   }

   static _renderSaveTargetRow(tokenDoc, consequence, dc, hpRolls = []) {
      const name = tokenDoc.actor?.name || tokenDoc.name || ""
      const save = consequence.save || "reflex"
      const saveLabel = this._saveLabel(save)
      return `<div class="target-row siege-consequence-target-row"
            data-target-uuid="${this._escape(tokenDoc.uuid)}"
            data-rolled="false"
            style="transition: filter 0.3s;">
         <hr>
         <div class="target-header">
            <span class="name"><i class="fa-solid fa-person"></i>${this._escape(name)}</span>
            <span class="controls" data-tooltip-class="pf2e">
               <a class="roll atw-mtcard-roll-save" data-action="roll-save" data-siege-consequence-action="save" data-statistic="${this._escape(save)}" data-dc="${this._escape(dc)}" data-tooltip="${this._escape(this._saveTooltip({ saveLabel, dc }))}">
                  <i class="save fa-solid ${this._escape(this._saveIcon(save))}"></i>
                  <i class="fa-solid fa-dice-d20 die"></i>
                  <span class="degree show hidden" style="cursor:pointer"></span>
               </a>
            </span>
         </div>
         <div class="siege-save-consequence-list hidden">
         </div>
      </div>`
   }

   static _renderDiceTooltip(rollData) {
      const parts = rollData.instances
         .map((instance) => {
            const type = instance.type || "untyped"
            const icon =
               type === "healing"
                  ? "fa-heart"
                  : DAMAGE_ICON_MAP[type] || DAMAGE_ICON_MAP.untyped
            const dice = this._diceRollsForInstance(instance)
            return `<section class="tooltip-part damage instance color ${this._escape(type)}">
               <header>
                  ${this._escape(capitalizeDamageType(type))} <i class="fa-solid ${this._escape(icon)}"></i>
               </header>
               <div class="dice">
                  <header class="part-header flexrow">
                     <span class="part-formula">${this._escape(instance.formula)}</span>
                     <span class="part-total">${this._escape(instance.total)}</span>
                  </header>
                  <ol class="dice-rolls">${dice}</ol>
               </div>
            </section>`
         })
         .join("")
      return `<div class="dice-tooltip"><div class="wrapper">${parts}</div></div>`
   }

   static _diceRollsForInstance(instance) {
      return (instance.dice || [])
         .map((die) => {
            const classes = ["roll", "die", `d${die.faces}`]
            if (die.value === 1) classes.push("min")
            if (die.value === die.faces) classes.push("max")
            return `<li class="${classes.map((c) => this._escape(c)).join(" ")}">${this._escape(die.value)}</li>`
         })
         .join("")
   }

   static _diceResultsForInstance(instance, roll, index) {
      const diceSource =
         instance?.dice ||
         instance?.head?.dice ||
         (roll?.dice?.[index] && [roll.dice[index]]) ||
         []
      return Array.from(diceSource).flatMap((die) => {
         const faces = Number(die.faces) || Number(die.number) || 20
         return Array.from(die.results || []).map((result) => ({
            faces,
            value: Number(result.result ?? result.value ?? 0) || 0,
         }))
      })
   }
}

export const consequenceCardRenderMethods = staticMethods(ConsequenceCardRenderMixin)
