import { tKey } from "../../utils.mjs"
import {
   DEFAULT_DAMAGE_PART,
   DEFAULT_HEAL_PART,
   defaultConsequence,
   normalizeConsequences,
   normalizeDamageParts,
   normalizeHealParts,
} from "./consequences.mjs"

export function bindConsequenceListeners({
   html,
   flags,
   saveFlags,
   setFlagWithScroll,
   refreshEffectValidation,
   refreshRuleValidation,
   effectFromDrop,
}) {   const consequenceRow = (target) =>
      $(target).closest(".siege-consequence-row")
   const consequenceIndex = (target) => consequenceRow(target).data("index")
   const updateConsequenceBasics = (row) => {
      const idx = row.data("index")
      const existing =
         flags.consequences[idx] || defaultConsequence()
      const effectInput = row.find(".consequence-effect-uuid")
      const ruleInput = row.find(".consequence-rule-json")
      const saveInput = row.find(".consequence-save")
      const dcInput = row.find(".consequence-save-dc")
      const basicSaveInput = row.find(".consequence-basic-save-cb")
      flags.consequences[idx] = normalizeConsequences([
         {
            ...existing,
            outcome:
               row.find(".consequence-outcome").val() ||
               existing.outcome,
            type: row.find(".consequence-type").val() || existing.type,
            target:
               row.find(".consequence-target").val() ||
               existing.target,
            condition:
               row.find(".consequence-condition").val() ||
               existing.condition,
            value:
               parseInt(row.find(".consequence-condition-value").val()) ||
               existing.value,
            hasDuration: row.find(".consequence-duration-cb").is(":checked"),
            durationUnit:
               row.find(".consequence-duration-unit").val() ||
               existing.durationUnit,
            durationValue:
               parseInt(row.find(".consequence-duration-value").val()) ||
               existing.durationValue,
            effectUuid: effectInput.length
               ? String(effectInput.val() || "").trim()
               : existing.effectUuid,
            ruleJson: ruleInput.length
               ? String(ruleInput.val() ?? "")
               : existing.ruleJson,
            save: saveInput.length ? saveInput.val() : existing.save,
            dc: dcInput.length ? String(dcInput.val() ?? "").trim() : existing.dc,
            basicSave: basicSaveInput.length
               ? basicSaveInput.is(":checked")
               : existing.basicSave,
            basicDamageParts: existing.basicDamageParts,
            consequences: existing.consequences || [],
         },
      ])[0]
   }
   const updateConsequenceDamageParts = (row) => {
      const idx = row.data("index")
      const parts = row
         .find(".consequence-damage-part-row")
         .toArray()
         .map((el) => {
            const part = $(el)
            return {
               dice: parseInt(part.find(".cdp-dice").val()) || 0,
               die: part.find(".cdp-die").val(),
               type: part.find(".cdp-type").val(),
               category: part.find(".cdp-category").val(),
            }
         })
      flags.consequences[idx].damageParts = normalizeDamageParts(parts)
   }
   const updateConsequenceHealParts = (row) => {
      const idx = row.data("index")
      const parts = row
         .find(".consequence-heal-part-row")
         .toArray()
         .map((el) => {
            const part = $(el)
            return {
               dice: parseInt(part.find(".chp-dice").val()) || 0,
               die: part.find(".chp-die").val(),
               bonus: parseInt(part.find(".chp-bonus").val()) || 0,
            }
         })
      flags.consequences[idx].healParts = normalizeHealParts(parts)
   }
   const updateConsequenceBasicDamageParts = (row) => {
      const idx = row.data("index")
      const parts = row
         .find(".basic-save-damage-part-row")
         .toArray()
         .map((el) => {
            const part = $(el)
            return {
               dice: parseInt(part.find(".basic-cdp-dice").val()) || 0,
               die: part.find(".basic-cdp-die").val(),
               type: part.find(".basic-cdp-type").val(),
               category: part.find(".basic-cdp-category").val(),
            }
         })
      flags.consequences[idx].basicDamageParts =
         normalizeDamageParts(parts)
   }
   const saveConsequenceRow = (target) =>
      $(target).closest(".siege-save-consequence-row")
   const saveConsequenceParentRow = (row) =>
      row.closest(".consequence-saving-throw").closest(".siege-consequence-row")
   const saveConsequenceList = (parentRow) => {
      const parentIdx = parentRow.data("index")
      const parent =
         flags.consequences[parentIdx] || defaultConsequence("saving-throw")
      parent.consequences = normalizeConsequences(parent.consequences, {
         allowSavingThrow: false,
      }).map((consequence) => ({
         ...consequence,
         target: "crewman",
      }))
      flags.consequences[parentIdx] = parent
      return parent.consequences
   }
   const updateSaveConsequenceBasics = (row) => {
      const parentRow = saveConsequenceParentRow(row)
      const list = saveConsequenceList(parentRow)
      const idx = row.data("index")
      const existing = list[idx] || defaultConsequence()
      const effectInput = row.find(".save-consequence-effect-uuid")
      const ruleInput = row.find(".save-consequence-rule-json")
      list[idx] = normalizeConsequences(
         [
            {
               ...existing,
               outcome:
                  row.find(".save-consequence-outcome").val() ||
                  existing.outcome,
               type:
                  row.find(".save-consequence-type").val() ||
                  existing.type,
               target: "crewman",
               condition:
                  row.find(".save-consequence-condition").val() ||
                  existing.condition,
               value:
                  parseInt(row.find(".save-consequence-condition-value").val()) ||
                  existing.value,
               hasDuration: row.find(".save-consequence-duration-cb").is(":checked"),
               durationUnit:
                  row.find(".save-consequence-duration-unit").val() ||
                  existing.durationUnit,
               durationValue:
                  parseInt(row.find(".save-consequence-duration-value").val()) ||
                  existing.durationValue,
               effectUuid: effectInput.length
                  ? String(effectInput.val() || "").trim()
                  : existing.effectUuid,
               ruleJson: ruleInput.length
                  ? String(ruleInput.val() ?? "")
                  : existing.ruleJson,
               damageParts: existing.damageParts,
               healParts: existing.healParts,
            },
         ],
         { allowSavingThrow: false },
      )[0]
   }
   const updateSaveConsequenceDamageParts = (row) => {
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      const idx = row.data("index")
      const parts = row
         .find(".save-consequence-damage-part-row")
         .toArray()
         .map((el) => {
            const part = $(el)
            return {
               dice: parseInt(part.find(".save-cdp-dice").val()) || 0,
               die: part.find(".save-cdp-die").val(),
               type: part.find(".save-cdp-type").val(),
               category: part.find(".save-cdp-category").val(),
            }
         })
      list[idx].damageParts = normalizeDamageParts(parts)
   }
   const updateSaveConsequenceHealParts = (row) => {
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      const idx = row.data("index")
      const parts = row
         .find(".save-consequence-heal-part-row")
         .toArray()
         .map((el) => {
            const part = $(el)
            return {
               dice: parseInt(part.find(".save-chp-dice").val()) || 0,
               die: part.find(".save-chp-die").val(),
               bonus: parseInt(part.find(".save-chp-bonus").val()) || 0,
            }
         })
      list[idx].healParts = normalizeHealParts(parts)
   }

   html.find(".add-consequence").on("click", async (e) => {
      e.preventDefault()
      flags.consequences.push(defaultConsequence())
      await setFlagWithScroll()
   })

   html.find(".remove-consequence").on("click", async (e) => {
      e.preventDefault()
      const idx = consequenceIndex(e.currentTarget)
      flags.consequences.splice(idx, 1)
      await setFlagWithScroll()
   })

   html.find(".add-save-consequence").on("click", async (e) => {
      e.preventDefault()
      const parentRow = consequenceRow(e.currentTarget)
      const list = saveConsequenceList(parentRow)
      list.push(defaultConsequence())
      await setFlagWithScroll()
   })

   html.find(".remove-save-consequence").on("click", async (e) => {
      e.preventDefault()
      const row = saveConsequenceRow(e.currentTarget)
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      list.splice(row.data("index"), 1)
      await setFlagWithScroll()
   })

   html.find(".consequence-outcome").on("change", async (e) => {
      updateConsequenceBasics(consequenceRow(e.currentTarget))
      await saveFlags()
   })

   html.find(".save-consequence-outcome").on("change", async (e) => {
      updateSaveConsequenceBasics(saveConsequenceRow(e.currentTarget))
      await saveFlags()
   })

   html.find(".consequence-type").on("change", async (e) => {
      const row = consequenceRow(e.currentTarget)
      updateConsequenceBasics(row)
      const idx = row.data("index")
      const type = flags.consequences[idx].type
      flags.consequences[idx] = {
         ...defaultConsequence(type),
         ...flags.consequences[idx],
         type,
      }
      await setFlagWithScroll()
   })

   html.find(".save-consequence-type").on("change", async (e) => {
      const row = saveConsequenceRow(e.currentTarget)
      updateSaveConsequenceBasics(row)
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      const idx = row.data("index")
      const type = list[idx].type === "saving-throw"
         ? "apply-condition"
         : list[idx].type
      list[idx] = {
         ...defaultConsequence(type),
         ...list[idx],
         type,
         consequences: [],
      }
      await setFlagWithScroll()
   })

   html
      .find(
         ".consequence-condition-value, .consequence-target, .consequence-duration-unit, .consequence-duration-value",
      )
      .on("change", async (e) => {
         updateConsequenceBasics(consequenceRow(e.currentTarget))
         await saveFlags()
      })

   html
      .find(
         ".save-consequence-condition-value, .save-consequence-duration-unit, .save-consequence-duration-value",
      )
      .on("change", async (e) => {
         updateSaveConsequenceBasics(saveConsequenceRow(e.currentTarget))
         await saveFlags()
      })

   html.find(".consequence-condition").on("change", async (e) => {
      updateConsequenceBasics(consequenceRow(e.currentTarget))
      await setFlagWithScroll()
   })

   html.find(".save-consequence-condition").on("change", async (e) => {
      updateSaveConsequenceBasics(saveConsequenceRow(e.currentTarget))
      await setFlagWithScroll()
   })

   html.find(".consequence-duration-cb").on("change", async (e) => {
      const row = consequenceRow(e.currentTarget)
      row.find(".consequence-duration-controls").toggle(e.currentTarget.checked)
      updateConsequenceBasics(row)
      await saveFlags()
   })

   html.find(".save-consequence-duration-cb").on("change", async (e) => {
      const row = saveConsequenceRow(e.currentTarget)
      row
         .find(".save-consequence-duration-controls")
         .toggle(e.currentTarget.checked)
      updateSaveConsequenceBasics(row)
      await saveFlags()
   })

   const refreshEffect = foundry.utils.debounce(
      () => refreshEffectValidation(html),
      120,
   )
   html.find(".consequence-effect-uuid").on("input", (e) => {
      refreshEffect()
   })
   html.find(".consequence-effect-uuid").on("change", async (e) => {
      updateConsequenceBasics(consequenceRow(e.currentTarget))
      await saveFlags()
      await refreshEffectValidation(html)
   })
   html.find(".save-consequence-effect-uuid").on("input", () => {
      refreshEffect()
   })
   html.find(".save-consequence-effect-uuid").on("change", async (e) => {
      updateSaveConsequenceBasics(saveConsequenceRow(e.currentTarget))
      await saveFlags()
      await refreshEffectValidation(html)
   })
   html
      .find(".consequence-effect-row, .consequence-effect-uuid")
      .on("dragover", (e) => {
         e.preventDefault()
         const ev = e.originalEvent || e
         if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
         $(e.currentTarget)
            .closest(".consequence-effect-row")
            .addClass("dragover")
      })
      .on("dragleave", (e) => {
         $(e.currentTarget)
            .closest(".consequence-effect-row")
            .removeClass("dragover")
      })
      .on("drop", async (e) => {
         e.preventDefault()
         e.stopPropagation()
         const row = consequenceRow(e.currentTarget)
         row.find(".consequence-effect-row").removeClass("dragover")
         const effect = await effectFromDrop(e)
         if (!effect) {
            ui.notifications.warn(tKey("ActionTab.InvalidUUID"))
            return
         }
         row.find(".consequence-effect-uuid").val(effect.uuid)
         updateConsequenceBasics(row)
         await saveFlags()
         await refreshEffectValidation(html)
      })
   html
      .find(".save-consequence-effect-row, .save-consequence-effect-uuid")
      .on("dragover", (e) => {
         e.preventDefault()
         const ev = e.originalEvent || e
         if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
         $(e.currentTarget)
            .closest(".save-consequence-effect-row")
            .addClass("dragover")
      })
      .on("dragleave", (e) => {
         $(e.currentTarget)
            .closest(".save-consequence-effect-row")
            .removeClass("dragover")
      })
      .on("drop", async (e) => {
         e.preventDefault()
         e.stopPropagation()
         const row = saveConsequenceRow(e.currentTarget)
         row.find(".save-consequence-effect-row").removeClass("dragover")
         const effect = await effectFromDrop(e)
         if (!effect) {
            ui.notifications.warn(tKey("ActionTab.InvalidUUID"))
            return
         }
         row.find(".save-consequence-effect-uuid").val(effect.uuid)
         updateSaveConsequenceBasics(row)
         await saveFlags()
         await refreshEffectValidation(html)
      })
   html.find(".consequence-effect-link").on("click", async (e) => {
      e.preventDefault()
      const uuid = $(e.currentTarget).attr("data-uuid")
      if (!uuid) return
      const doc = await fromUuid(uuid).catch(() => null)
      doc?.sheet?.render(true)
   })
   html.find(".save-consequence-effect-link").on("click", async (e) => {
      e.preventDefault()
      const uuid = $(e.currentTarget).attr("data-uuid")
      if (!uuid) return
      const doc = await fromUuid(uuid).catch(() => null)
      doc?.sheet?.render(true)
   })

   const refreshRule = foundry.utils.debounce(
      () => refreshRuleValidation(html),
      100,
   )
   html.find(".consequence-rule-json").on("input", () => refreshRule())
   html.find(".consequence-rule-json").on("change", async (e) => {
      updateConsequenceBasics(consequenceRow(e.currentTarget))
      await saveFlags()
      refreshRuleValidation(html)
   })
   html.find(".save-consequence-rule-json").on("input", () => refreshRule())
   html.find(".save-consequence-rule-json").on("change", async (e) => {
      updateSaveConsequenceBasics(saveConsequenceRow(e.currentTarget))
      await saveFlags()
      refreshRuleValidation(html)
   })

   html.find(".add-consequence-damage-part").on("click", async (e) => {
      e.preventDefault()
      const idx = consequenceIndex(e.currentTarget)
      flags.consequences[idx].damageParts.push({ ...DEFAULT_DAMAGE_PART })
      await setFlagWithScroll()
   })

   html.find(".add-basic-save-damage-part").on("click", async (e) => {
      e.preventDefault()
      const idx = consequenceIndex(e.currentTarget)
      flags.consequences[idx].basicDamageParts =
         normalizeDamageParts(flags.consequences[idx].basicDamageParts)
      flags.consequences[idx].basicDamageParts.push({ ...DEFAULT_DAMAGE_PART })
      await setFlagWithScroll()
   })

   html.find(".add-save-consequence-damage-part").on("click", async (e) => {
      e.preventDefault()
      const row = saveConsequenceRow(e.currentTarget)
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      list[row.data("index")].damageParts.push({ ...DEFAULT_DAMAGE_PART })
      await setFlagWithScroll()
   })

   html.find(".remove-consequence-damage-part").on("click", async (e) => {
      e.preventDefault()
      const row = consequenceRow(e.currentTarget)
      const idx = row.data("index")
      const partIdx = $(e.currentTarget)
         .closest(".consequence-damage-part-row")
         .data("partIndex")
      flags.consequences[idx].damageParts.splice(partIdx, 1)
      if (flags.consequences[idx].damageParts.length === 0)
         flags.consequences[idx].damageParts.push({ ...DEFAULT_DAMAGE_PART })
      await setFlagWithScroll()
   })

   html.find(".remove-basic-save-damage-part").on("click", async (e) => {
      e.preventDefault()
      const row = consequenceRow(e.currentTarget)
      const idx = row.data("index")
      const partIdx = $(e.currentTarget)
         .closest(".basic-save-damage-part-row")
         .data("partIndex")
      flags.consequences[idx].basicDamageParts =
         normalizeDamageParts(flags.consequences[idx].basicDamageParts)
      flags.consequences[idx].basicDamageParts.splice(partIdx, 1)
      if (flags.consequences[idx].basicDamageParts.length === 0)
         flags.consequences[idx].basicDamageParts.push({
            ...DEFAULT_DAMAGE_PART,
         })
      await setFlagWithScroll()
   })

   html.find(".remove-save-consequence-damage-part").on("click", async (e) => {
      e.preventDefault()
      const row = saveConsequenceRow(e.currentTarget)
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      const idx = row.data("index")
      const partIdx = $(e.currentTarget)
         .closest(".save-consequence-damage-part-row")
         .data("partIndex")
      list[idx].damageParts.splice(partIdx, 1)
      if (list[idx].damageParts.length === 0)
         list[idx].damageParts.push({ ...DEFAULT_DAMAGE_PART })
      await setFlagWithScroll()
   })

   html
      .find(".cdp-dice, .cdp-die, .cdp-type, .cdp-category")
      .on("change", async (e) => {
         const row = consequenceRow(e.currentTarget)
         updateConsequenceDamageParts(row)
         await saveFlags()
      })

   html
      .find(
         ".basic-cdp-dice, .basic-cdp-die, .basic-cdp-type, .basic-cdp-category",
      )
      .on("change", async (e) => {
         const row = consequenceRow(e.currentTarget)
         updateConsequenceBasicDamageParts(row)
         await saveFlags()
      })

   html
      .find(".save-cdp-dice, .save-cdp-die, .save-cdp-type, .save-cdp-category")
      .on("change", async (e) => {
         const row = saveConsequenceRow(e.currentTarget)
         updateSaveConsequenceDamageParts(row)
         await saveFlags()
      })

   html.find(".add-consequence-heal-part").on("click", async (e) => {
      e.preventDefault()
      const idx = consequenceIndex(e.currentTarget)
      flags.consequences[idx].healParts.push({ ...DEFAULT_HEAL_PART })
      await setFlagWithScroll()
   })

   html.find(".add-save-consequence-heal-part").on("click", async (e) => {
      e.preventDefault()
      const row = saveConsequenceRow(e.currentTarget)
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      list[row.data("index")].healParts.push({ ...DEFAULT_HEAL_PART })
      await setFlagWithScroll()
   })

   html.find(".remove-consequence-heal-part").on("click", async (e) => {
      e.preventDefault()
      const row = consequenceRow(e.currentTarget)
      const idx = row.data("index")
      const partIdx = $(e.currentTarget)
         .closest(".consequence-heal-part-row")
         .data("partIndex")
      flags.consequences[idx].healParts.splice(partIdx, 1)
      if (flags.consequences[idx].healParts.length === 0)
         flags.consequences[idx].healParts.push({ ...DEFAULT_HEAL_PART })
      await setFlagWithScroll()
   })

   html.find(".remove-save-consequence-heal-part").on("click", async (e) => {
      e.preventDefault()
      const row = saveConsequenceRow(e.currentTarget)
      const list = saveConsequenceList(saveConsequenceParentRow(row))
      const idx = row.data("index")
      const partIdx = $(e.currentTarget)
         .closest(".save-consequence-heal-part-row")
         .data("partIndex")
      list[idx].healParts.splice(partIdx, 1)
      if (list[idx].healParts.length === 0)
         list[idx].healParts.push({ ...DEFAULT_HEAL_PART })
      await setFlagWithScroll()
   })

   html.find(".chp-dice, .chp-die, .chp-bonus").on("change", async (e) => {
      const row = consequenceRow(e.currentTarget)
      updateConsequenceHealParts(row)
      await saveFlags()
   })

   html.find(".save-chp-dice, .save-chp-die, .save-chp-bonus").on("change", async (e) => {
      const row = saveConsequenceRow(e.currentTarget)
      updateSaveConsequenceHealParts(row)
      await saveFlags()
   })

   html
      .find(".consequence-save, .consequence-save-dc")
      .on("change", async (e) => {
         updateConsequenceBasics(consequenceRow(e.currentTarget))
         await saveFlags()
      })

   html.find(".consequence-basic-save-cb").on("change", async (e) => {
      const row = consequenceRow(e.currentTarget)
      updateConsequenceBasics(row)
      await setFlagWithScroll()
   })

}
