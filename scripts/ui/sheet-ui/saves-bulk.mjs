import { MODULE_ID, DC_BY_LEVEL, D20_SVG } from "../../constants.mjs"
import { VehicleLoadManager } from "../../managers/vehicle-load.mjs"
import { SiegeCrewManager } from "../../managers/crew.mjs"
import { clampLevel, tKey } from "../../utils.mjs"
import { staticMethods } from "./helpers.mjs"

class SheetSavesBulkMixin {

   static _saveLabel(save) {
      if (save === "fortitude") return tKey("Attributes.Fortitude")
      if (save === "will") return tKey("Attributes.Will")
      return tKey("Attributes.Reflex")
   }



   static _vehicleSaveValue(actor, save) {
      const scope = actor.flags?.[MODULE_ID] || {}
      const direct = actor.getFlag(MODULE_ID, `saves.${save}.value`)
      const saveRoot = actor.getFlag(MODULE_ID, "saves")
      const candidates = [
         direct,
         saveRoot?.[save]?.value,
         foundry.utils.getProperty(scope, `saves.${save}.value`),
         foundry.utils.getProperty(actor.system || {}, `saves.${save}.value`),
         foundry.utils.getProperty(actor.system || {}, `saves.${save}.mod`),
      ]
      for (const candidate of candidates) {
         const number = Number(candidate)
         if (Number.isFinite(number)) return number
      }
      return 0
   }



   static _injectSaves(app, html) {
      const sidebar = html.find(".sidebar-saves")
      if (sidebar.length === 0) return
      const moduleSaves = app.document.getFlag(MODULE_ID, "moduleBonuses")?.saves || {}
      const saveRowHTML = (save) => {
         const baseValue = this._vehicleSaveValue(app.document, save)
         const moduleBonus = Number(moduleSaves?.[save]) || 0
         const substitute = SiegeCrewManager.vehicleSaveDisplaySubstitute(app.document, save)
         const displayValue = substitute ? substitute.value : baseValue
         const name = substitute ? "" : `name="flags.${MODULE_ID}.saves.${save}.value"`
         const readonly = substitute
            ? `readonly data-tooltip="${tKey("Crew.UseCrewSaveInfo", { save: this._saveLabel(save) })}" data-tooltip-direction="UP"`
            : ""
         const bonus = !substitute && moduleBonus
            ? `<span class="siege-module-save-bonus">+${moduleBonus}</span>`
            : ""
         return `<li class="roll-data" data-save="${save}">
            <h2 class="sidebar_label">${this._saveLabel(save)}</h2>
            <div class="save-roll">
               <a class="roll-icon custom-siege-save" data-save="${save}">
                  <div class="d20-svg">${D20_SVG}</div>
               </a>
               <input class="adjustable" ${name} type="number" value="${displayValue}" ${readonly}>
               ${bonus}
            </div>
         </li>`
      }

      for (const save of ["fortitude", "reflex", "will"]) {
         const rows = sidebar.find(`li.roll-data[data-save="${save}"]`)
         if (rows.length === 0) {
            sidebar.append(saveRowHTML(save))
            continue
         }

         const nativeRows = rows.filter((_, row) => $(row).find(".custom-siege-save").length === 0)
         const row = nativeRows.first().length ? nativeRows.first() : rows.first()
         rows.not(row).remove()

         const baseValue = this._vehicleSaveValue(app.document, save)
         const moduleBonus = Number(moduleSaves?.[save]) || 0
         const substitute = SiegeCrewManager.vehicleSaveDisplaySubstitute(app.document, save)
         const input = row.find("input.adjustable").first()
         const rollIcon = row.find(".roll-icon").first()
         rollIcon
            .addClass("custom-siege-save")
            .attr("data-save", save)
            .removeAttr("data-action")
            .removeAttr("data-statistic")
         row.find(".siege-module-save-bonus").remove()

         if (input.length > 0) {
            input.removeClass("siege-save-substituted")
            if (substitute) {
               input
                  .val(substitute.value)
                  .prop("readonly", true)
                  .removeAttr("name")
                  .removeAttr("data-property")
                  .attr("data-tooltip", tKey("Crew.UseCrewSaveInfo", { save: this._saveLabel(save) }))
                  .attr("data-tooltip-direction", "UP")
            } else {
               input
                  .prop("readonly", false)
                  .removeAttr("data-tooltip")
                  .removeAttr("data-tooltip-direction")
               if (!input.attr("name") && !input.attr("data-property"))
                  input.attr("name", `flags.${MODULE_ID}.saves.${save}.value`)
               if (moduleBonus)
                  input.after(`<span class="siege-module-save-bonus">+${moduleBonus}</span>`)
               if (!input.val()) input.val(baseValue)
            }
         }
      }

      html.find(".custom-siege-save").off("click.siege-save").on("click.siege-save", async (e) => {
         e.preventDefault()
         e.stopPropagation()
         const saveType = $(e.currentTarget).data("save")
         const rolledByCrew = await SiegeCrewManager.rollVehicleSaveSubstitute(
            app.document,
            saveType,
            e.originalEvent ?? e,
         )
         if (rolledByCrew) return
         const mod = this._vehicleSaveValue(app.document, saveType)
         const moduleBonus =
            Number(app.document.getFlag(MODULE_ID, "moduleBonuses")?.saves?.[saveType]) || 0
         const label = this._saveLabel(saveType)
         const title = tKey("Saves.Title", { name: label })

         try {
            const modifiers = [
               new game.pf2e.Modifier({
                  slug: "base",
                  label: tKey("Modifiers.Base"),
                  modifier: mod + moduleBonus,
                  type: "untyped",
               }),
            ]
            const checkMod = new game.pf2e.StatisticModifier(title, modifiers)
            game.pf2e.Check.roll(
               checkMod,
               { actor: app.document, type: "saving-throw", options: [] },
               e.originalEvent ?? e,
            )
         } catch (err) {
            const roll = new Roll(`1d20 + ${mod + moduleBonus}`)
            await roll.evaluate()
            roll.toMessage({
               speaker: ChatMessage.getSpeaker({ actor: app.document }),
               flavor: `<h4 class="action"><strong>${title}</strong></h4>`,
            })
         }
      })

   }



   static _injectBulk(app, html) {
      if (html.find(".siege-stat-grid").length > 0) return
      const speedInput = html.find('input[name="system.details.speed"]')
      const speedRow = speedInput.closest(".row-nr-2")

const showBulk = true
      this._injectPriceBulkColumn(app, html, showBulk)

      if (
         speedRow.length === 0 ||
         html.find(`input[name="flags.${MODULE_ID}.disableDC"]`).length > 0
      ) {
         this._toggleLoadCapacityColumn(app, speedRow)
         return
      }

      speedRow.removeClass("span-2-columns").addClass("siege-bulk-row")
      const rowTitle = speedRow.attr("title")
      if (rowTitle) speedRow.removeAttr("title")

      const speedLabel = speedRow.find('label[for*="speed"]')
      const speedWrapper = $('<div class="siege-bulk-col"></div>')
      if (rowTitle) speedWrapper.attr("title", rowTitle)
      speedLabel.add(speedInput).wrapAll(speedWrapper)

      const siegeLevel = clampLevel(app.document.system.details.level?.value)
      const disableDC =
         app.document.getFlag(MODULE_ID, "disableDC") || DC_BY_LEVEL[siegeLevel]

      const loadCapacityHtml = this._buildLoadCapacityColumnHTML(app)

      speedRow.append(`
         ${loadCapacityHtml}
         <div class="siege-bulk-col">
            <label class="details-label">${tKey("Attributes.DisableDC")}</label>
            <input class="details-input" name="flags.${MODULE_ID}.disableDC" type="number" value="${disableDC}">
         </div>
      `)
   }



   static _injectPriceBulkColumn(app, html, showBulk) {
      const existingBulk = html.find(".siege-portable-bulk")
      if (!showBulk) {
         html.find(".siege-portable-bulk").remove()
         return
      }
      const priceInput = html.find('input[name="system.details.price"]').first()
      if (priceInput.length === 0) return
      const topRow = html.find(".siege-dimensions-field").parent().first()
      const directPriceChild =
         topRow.length > 0
            ? topRow
                 .children()
                 .filter(function () {
                    return (
                       this === priceInput[0] ||
                       $(this).find('input[name="system.details.price"]').length > 0
                    )
                 })
                 .first()
            : $()
      const priceWrapper =
         directPriceChild.length > 0
            ? directPriceChild
            : this._singleControlWrapper(priceInput)
      if (priceWrapper.length === 0) return
      const bulkColumn =
         existingBulk.length > 0
            ? existingBulk.first().detach()
            : $(this._buildBulkColumnHTML(app))
      priceWrapper.after(bulkColumn)
      html.find(".siege-portable-bulk").not(bulkColumn).remove()
   }



   static _toggleLoadCapacityColumn(app, speedRow) {
      if (speedRow.length === 0) return
      if (speedRow.find(".siege-load-capacity").length === 0) {
         const disableDCCol = speedRow
            .find(`input[name="flags.${MODULE_ID}.disableDC"]`)
            .closest(".siege-bulk-col")
         disableDCCol.before(this._buildLoadCapacityColumnHTML(app))
      }
   }



   static _buildBulkColumnHTML(app) {
      const bulkLabel = tKey("Attributes.Bulk")
      const bulkValue = app.document.getFlag(MODULE_ID, "bulk") || 0
      return `
         <div class="siege-bulk-col siege-portable-bulk">
            <label class="details-label siege-bulk-label">${bulkLabel}</label>
            <input class="details-input" name="flags.${MODULE_ID}.bulk" type="number" value="${bulkValue}">
         </div>`
   }



   static _buildLoadCapacityColumnHTML(app) {
      const value =
         VehicleLoadManager.rawLoadCapacity(app.document) ??
         VehicleLoadManager.defaultLoadCapacity(app.document)
      return `
         <div class="siege-bulk-col siege-load-capacity">
            <label class="details-label">${tKey("Attributes.LoadCapacity")}</label>
            <input class="details-input" name="flags.${MODULE_ID}.loadCapacity" type="number" step="0.1" min="0" value="${value}">
         </div>`
   }



   static _injectLoadBulkGauge(app, html) {
      const status = VehicleLoadManager.status(app.document)
      const current = Number.isFinite(status.current) ? status.current : 0
      const max = Number.isFinite(status.max) ? status.max : 0
      const ratio = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0
      const percent = Math.round(ratio * 1000) / 10
      const hue = Math.round(128 - ratio * 128)
      const fillColor = `hsl(${hue}, 78%, ${status.atMax ? 38 : 44}%)`
      const line = `
         <div class="siege-load-gauge ${status.encumbered ? "siege-load-encumbered" : ""} ${status.atMax ? "siege-load-maxed" : ""}" style="--siege-load-percent: ${percent}%; --siege-load-color: ${fillColor};">
            <div class="siege-load-fill"></div>
            <div class="siege-load-gauge-content">
               <span>${tKey("VehicleLoad.Bulk")}: ${status.currentLabel} / ${tKey("VehicleLoad.Encumbered")}: ${status.encumberedLabel}</span>
               <span>${tKey("VehicleLoad.MaxBulk")}: ${status.maxLabel}</span>
            </div>
         </div>`

      const existing = html.find(".total-bulk").first()
      if (existing.length > 0) {
         existing.addClass("siege-load-total-bulk").html(line)
         return
      }

      const inventory = html.find('.tab.inventory[data-tab="inventory"]').first()
      if (inventory.length === 0 || inventory.find(".siege-load-gauge").length > 0)
         return
      const target = inventory.find(".inventory-list").first()
      if (target.length > 0) target.before(line)
      else inventory.prepend(line)
   }
}

export const sheetSavesBulkMethods = staticMethods(SheetSavesBulkMixin)
