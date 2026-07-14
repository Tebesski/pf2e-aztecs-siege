import { MODULE_ID, DC_BY_LEVEL } from "../constants.mjs"
import { VehicleLoadManager } from "../managers/vehicle-load.mjs"
import {
   clampLevel,
   isSiege,
   tKey,
} from "../utils.mjs"
import { SiegeSFXManager } from "../managers/sfx.mjs"
import { actionDisabledReason } from "../macros/helpers.mjs"
import { sheetAmmunitionMethods } from "./sheet-ui/ammunition.mjs"
import { sheetSavesBulkMethods } from "./sheet-ui/saves-bulk.mjs"

export class SiegeSheetUI {
   static renderSheet(app, html, data) {
      if (app.document.type !== "vehicle") return
      const isSiegeWeapon = isSiege(app.document)
      this._injectToggle(app, html, isSiegeWeapon)
      if (!isSiegeWeapon) return

      this._compactDimensionInputs(app, html)
      this._transformToSiegeWeapon(app, html)
      SiegeSFXManager.buildTabUI(app, html)
   }

   static _compactDimensionInputs(app, html) {
      if (html.find(".siege-stat-grid").length > 0) {
         this._bindDimensionInput(
            app,
            html.find(".siege-stat-grid .siege-dimensions-control").first(),
         )
         return
      }

      const existingCombined = html.find(".siege-dimensions-control").first()
      if (existingCombined.length > 0) {
         this._bindDimensionInput(app, existingCombined)
         return
      }

      const dimensionSelector = [
         'input[name="system.details.space.long"]',
         'input[name="system.details.space.wide"]',
         'input[name="system.details.space.high"]',
      ].join(",")
      const lengthInput = html
         .find('input[name="system.details.space.long"]')
         .first()
      const widthInput = html
         .find('input[name="system.details.space.wide"]')
         .first()
      const heightInput = html
         .find('input[name="system.details.space.high"]')
         .first()

      if (
         lengthInput.length === 0 ||
         widthInput.length === 0 ||
         heightInput.length === 0 ||
         lengthInput.closest(".siege-dimensions-field").length > 0
      )
         return

      const wrappers = [lengthInput, widthInput, heightInput].map((input) =>
         this._dimensionInputWrapper(input, dimensionSelector),
      )
      const uniqueWrappers = [
         ...new Map(wrappers.filter((w) => w.length > 0).map((w) => [w[0], w])).values(),
      ]
      if (uniqueWrappers.length !== 3) return

      const space = app.document.system?.details?.space || {}
      const field = $(`
         <div class="inputSplit siege-dimensions-field">
            <label class="details-label siege-dimensions-label">
               ${tKey("Attributes.Dimensions")}
               <i class="fa-solid fa-circle-info siege-info-icon" data-tooltip="${tKey("Sheet.DimensionsTooltip")}" data-tooltip-direction="UP"></i>
            </label>
            ${this._dimensionControlHTML(space)}
         </div>
      `)

      uniqueWrappers[0].before(field)
      for (const wrapper of uniqueWrappers) wrapper.remove()
      this._bindDimensionInput(app, field.find(".siege-dimensions-control"))
   }

   static _rebuildVehicleStatLayout(app, html) {
      if (html.find(".siege-stat-grid").length > 0) {
         this._bindDimensionInput(
            app,
            html.find(".siege-stat-grid .siege-dimensions-control").first(),
         )
         return
      }

      const priceInput = html.find('input[name="system.details.price"]').first()
      const speedInput = html.find('input[name="system.details.speed"]').first()
      const dimensionField = html.find(".siege-dimensions-field").first()
      const anchor = dimensionField.length
         ? dimensionField
         : priceInput.length
           ? priceInput
           : speedInput
      if (anchor.length === 0) return

      const container =
         anchor.closest(".detail-sheet").first().length > 0
            ? anchor.closest(".detail-sheet").first()
            : anchor.closest(".vehicle-details, .details-content, .sheet-body").first()
      if (container.length === 0) return

      const doc = app.document
      const sys = doc.system || {}
      const siegeLevel = clampLevel(sys.details?.level?.value)
      const disableDC = doc.getFlag(MODULE_ID, "disableDC") || DC_BY_LEVEL[siegeLevel]
      const loadCapacity =
         VehicleLoadManager.rawLoadCapacity(doc) ??
         VehicleLoadManager.defaultLoadCapacity(doc)

      const grid = $(`
         <div class="siege-stat-grid">
            <div class="siege-stat-row siege-stat-row-top">
               <div class="inputSplit siege-stat-field siege-dimensions-field">
                  <label class="details-label siege-dimensions-label">
                     ${tKey("Attributes.Dimensions")}
                     <i class="fa-solid fa-circle-info siege-info-icon" data-tooltip="${tKey("Sheet.DimensionsTooltip")}" data-tooltip-direction="UP"></i>
                  </label>
                  ${this._dimensionControlHTML(sys.details?.space || {})}
               </div>
               ${this._sheetStatInputHTML("Attributes.Price", "system.details.price", sys.details?.price ?? 0, "number")}
               ${this._buildBulkColumnHTML(app)}
            </div>
            <div class="siege-stat-row siege-stat-row-bottom">
               ${this._sheetStatInputHTML("Attributes.Speed", "system.details.speed", sys.details?.speed ?? "", "text")}
               ${this._sheetStatInputHTML("Attributes.LoadCapacity", `flags.${MODULE_ID}.loadCapacity`, loadCapacity, "number", 'step="0.1" min="0"', "siege-load-capacity")}
               ${this._sheetStatInputHTML("Attributes.DisableDC", `flags.${MODULE_ID}.disableDC`, disableDC, "number")}
            </div>
         </div>
      `)

      const originalTopRow = dimensionField.parent().first()
      const useOriginalTopRow =
         dimensionField.length > 0 &&
         originalTopRow.length > 0 &&
         !originalTopRow.hasClass("detail-sheet") &&
         originalTopRow.find('input[name="system.details.price"]').length > 0
      const insertionPoint = useOriginalTopRow
         ? originalTopRow
         : dimensionField.length
           ? dimensionField
           : this._singleControlWrapper(priceInput.length ? priceInput : speedInput)
      insertionPoint.before(grid)

      const removeTargets = new Set()
      if (useOriginalTopRow) removeTargets.add(originalTopRow[0])
      if (dimensionField.length > 0) removeTargets.add(dimensionField[0])
      const originalSpeedRow = speedInput.closest(".row-nr-2").first()
      if (
         originalSpeedRow.length > 0 &&
         !originalSpeedRow.hasClass("siege-stat-row")
      )
         removeTargets.add(originalSpeedRow[0])
      for (const name of [
         "system.details.price",
         "system.details.speed",
         `flags.${MODULE_ID}.bulk`,
         `flags.${MODULE_ID}.loadCapacity`,
         `flags.${MODULE_ID}.disableDC`,
      ]) {
         const input = html.find(`input[name="${name}"]`).not(grid.find("input")).first()
         if (input.length > 0) removeTargets.add(this._singleControlWrapper(input)[0])
      }
      for (const target of removeTargets) {
         if (target && !grid[0].contains(target) && !target.contains(grid[0]))
            $(target).remove()
      }

      this._bindDimensionInput(app, grid.find(".siege-dimensions-control"))
   }

   static _sheetStatInputHTML(labelKey, name, value, type, attrs = "", extraClass = "") {
      return `
         <div class="siege-bulk-col siege-stat-field ${extraClass}">
            <label class="details-label">${tKey(labelKey)}</label>
            <input class="details-input" name="${name}" type="${type}" value="${this._escapeAttr(value)}" ${attrs}>
         </div>`
   }

   static _bindDimensionInput(app, control) {
      control.off(".siegeDimensions")
      control.find(".siege-dimension-part").off(".siegeDimensions")

      control.on("click.siegeDimensions", (event) => {
         if (event.target === control[0])
            control.find(".siege-dimension-part").first().trigger("focus")
      })

      control.find(".siege-dimension-part").on("change.siegeDimensions", async () => {
         const parsed = this._readDimensionControl(control)
         if (!parsed) {
            ui.notifications.warn(tKey("Notifications.InvalidDimensions"))
            this._setDimensionControl(
               control,
               app.document.system?.details?.space || {},
            )
            return
         }
         await app.document.update({
            "system.details.space.long": parsed.long,
            "system.details.space.wide": parsed.wide,
            "system.details.space.high": parsed.high,
         })
      })

      control.find(".siege-dimension-part").on("keydown.siegeDimensions", (event) => {
         if (event.key === "Enter") {
            event.preventDefault()
            event.currentTarget.blur()
         } else if (event.key === "/") {
            event.preventDefault()
            const parts = control.find(".siege-dimension-part")
            const index = parts.index(event.currentTarget)
            parts.eq(Math.min(index + 1, parts.length - 1)).trigger("focus")
         }
      })
   }

   static _dimensionControlHTML(space) {
      const values = this._dimensionParts(space)
      const input = (key, labelKey) => `
         <input class="siege-dimension-part" data-dimension="${key}" type="text" inputmode="decimal" value="${this._escapeAttr(values[key])}" aria-label="${tKey(labelKey)}">`
      return `
         <div class="details-input siege-dimensions-control" role="group" aria-label="${tKey("Attributes.Dimensions")}">
            ${input("long", "Attributes.Length")}
            <span class="siege-dimensions-separator" aria-hidden="true">/</span>
            ${input("wide", "Attributes.Width")}
            <span class="siege-dimensions-separator" aria-hidden="true">/</span>
            ${input("high", "Attributes.Height")}
         </div>`
   }

   static _dimensionParts(space) {
      return {
         long: space.long ?? "",
         wide: space.wide ?? "",
         high: space.high ?? space.height ?? "",
      }
   }

   static _dimensionDisplay(space) {
      const parts = this._dimensionParts(space)
      return [parts.long, parts.wide, parts.high].join(" / ")
   }

   static _readDimensionControl(control) {
      const values = ["long", "wide", "high"].map((key) =>
         String(
            control.find(`.siege-dimension-part[data-dimension="${key}"]`).val() ??
               "",
         ).trim(),
      )
      if (values.some((value) => value === "")) return null
      const numbers = values.map((value) => Number(value))
      if (numbers.some((number) => !Number.isFinite(number) || number < 0))
         return null
      return { long: numbers[0], wide: numbers[1], high: numbers[2] }
   }

   static _setDimensionControl(control, space) {
      const values = this._dimensionParts(space)
      for (const key of ["long", "wide", "high"])
         control
            .find(`.siege-dimension-part[data-dimension="${key}"]`)
            .val(values[key])
   }

   static _escapeAttr(value) {
      return foundry.utils.escapeHTML?.(value ?? "") ?? String(value ?? "")
   }

   static _dimensionInputWrapper(input, dimensionSelector) {
      const selectors = [
         ".inputSplit",
         ".detailsInput",
         ".form-group",
         ".form-group-stacked",
         ".form-field",
         ".form-row",
         "li",
      ]
      for (const selector of selectors) {
         const candidate = input.closest(selector)
         if (
            candidate.length > 0 &&
            candidate.find(dimensionSelector).length === 1
         )
            return candidate
      }
      const labeled = input
         .parents("div")
         .filter(function () {
            const candidate = $(this)
            return (
               candidate.find("label").length > 0 &&
               candidate.find(dimensionSelector).length === 1
            )
         })
         .first()
      return labeled.length > 0 ? labeled : input.parent()
   }

   static _singleControlWrapper(input) {
      const selectors = [
         ".inputSplit",
         ".detailsInput",
         ".form-group",
         ".form-group-stacked",
         ".form-field",
         ".form-row",
         "li",
      ]
      const controls = "input:not([type='hidden']), select, textarea"
      for (const selector of selectors) {
         const candidate = input.closest(selector)
         if (
            candidate.length > 0 &&
            candidate.find(controls).length === 1 &&
            candidate.find(controls).first()[0] === input[0]
         )
            return candidate
      }
      return input.parent()
   }

   static _injectToggle(app, html, isSiegeWeapon) {
      if (html.find(".siege-weapon-toggle").length === 0) {
         html.find(".vehicle-properties").append(`
            <div class="detailsInput flexitem-full siege-weapon-toggle">
               <input type="checkbox" id="siege-toggle-${app.document.id}" class="siege-convert-checkbox siege-checkbox" ${isSiegeWeapon ? "checked" : ""}>
               <label for="siege-toggle-${app.document.id}" class="siege-checkbox-label">${tKey("Sheet.ConvertToSiege")}</label>
            </div>
         `)
         html.find(".siege-convert-checkbox").on("change", async (e) => {
            const enabled = e.target.checked
            const update = {
               [`flags.${MODULE_ID}.isSiegeWeapon`]: e.target.checked,
            }
            if (!enabled) {
               update[`flags.${MODULE_ID}.enterable`] = false
               update[`flags.${MODULE_ID}.drivable`] = false
               update[`flags.${MODULE_ID}.rotatable`] = false
               update[`flags.${MODULE_ID}.allowCrewTargeting`] = false
            }
            await app.document.update(update)
         })
      }

      if (isSiegeWeapon) this._injectEnterableToggles(app, html, isSiegeWeapon)

      if (isSiegeWeapon && html.find(".siege-needs-ignition-toggle").length === 0) {
         const needsIgnition =
            app.document.getFlag(MODULE_ID, "needsIgnition") === true
         const ignitionSlugs =
            app.document.getFlag(MODULE_ID, "ignitionItemSlugs") || ""
         html.find(".vehicle-properties").append(`
            <div class="detailsInput flexitem-full siege-needs-ignition-toggle">
               <input type="checkbox" id="siege-needs-ignition-${app.document.id}" class="siege-needs-ignition-checkbox siege-checkbox" ${needsIgnition ? "checked" : ""}>
               <label for="siege-needs-ignition-${app.document.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.NeedsIgnition")}</label>
               <input type="text" class="siege-ignition-slugs-input" value="${foundry.utils.escapeHTML?.(ignitionSlugs) ?? ignitionSlugs}" placeholder="${tKey("Sheet.IgnitionItemSlugsPlaceholder")}" style="${needsIgnition ? "" : "display:none;"}">
            </div>
         `)
         html.find(".siege-needs-ignition-checkbox").on("change", async (e) => {
            html.find(".siege-ignition-slugs-input").toggle(e.target.checked)
            await app.document.update({
               [`flags.${MODULE_ID}.needsIgnition`]: e.target.checked,
            })
         })
         html.find(".siege-ignition-slugs-input").on("change", async (e) => {
            await app.document.update({
               [`flags.${MODULE_ID}.ignitionItemSlugs`]: String(
                  e.currentTarget.value || "",
               ).trim(),
            })
         })
      }

      if (isSiegeWeapon && html.find(".siege-mountable-toggle").length === 0) {
         const isMountable =
            app.document.getFlag(MODULE_ID, "mountableByPCs") !== false
         html.find(".vehicle-properties").append(`
            <div class="detailsInput flexitem-full siege-mountable-toggle">
               <input type="checkbox" id="siege-mountable-${app.document.id}" class="siege-mountable-checkbox siege-checkbox" ${isMountable ? "checked" : ""}>
               <label for="siege-mountable-${app.document.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.MountableByPCs")}</label>
            </div>
         `)
         html.find(".siege-mountable-checkbox").on("change", async (e) => {
            await app.document.update({
               [`flags.${MODULE_ID}.mountableByPCs`]: e.target.checked,
            })
         })
      }
   }

static _injectEnterableToggles(app, html, isSiegeWeapon) {
      if (html.find(".siege-enterable-toggle").length > 0) return

      const traits = app.document.system.traits?.value || []
      if (traits.includes("portable")) return

      const doc = app.document
      const enterable = !!doc.getFlag(MODULE_ID, "enterable")
      const drivable = !!doc.getFlag(MODULE_ID, "drivable")
      const rotatable = !!doc.getFlag(MODULE_ID, "rotatable")
      const allowCrewTargeting = !!doc.getFlag(MODULE_ID, "allowCrewTargeting")

      const info = (key) =>
         `<i class="fa-solid fa-circle-info siege-info-icon" data-tooltip="${tKey(key)}" data-tooltip-direction="UP"></i>`

const convertToggle = html.find(".siege-weapon-toggle")
      const enterableHtml = `
         <span class="siege-enterable-toggle siege-inline-toggle">
            <input type="checkbox" id="siege-enterable-${doc.id}" class="siege-enterable-checkbox siege-checkbox" ${enterable ? "checked" : ""}>
            <label for="siege-enterable-${doc.id}" class="siege-checkbox-label">${tKey("Sheet.Enterable")} ${info("Sheet.EnterableTooltip")}</label>
         </span>`
      if (convertToggle.length > 0) convertToggle.append(enterableHtml)
      else html.find(".vehicle-properties").append(enterableHtml)

html.find(".vehicle-properties").append(`
         <div class="detailsInput flexitem-full siege-drivable-toggle" style="${enterable ? "" : "display:none;"}">
            <input type="checkbox" id="siege-drivable-${doc.id}" class="siege-drivable-checkbox siege-checkbox" ${drivable ? "checked" : ""}>
            <label for="siege-drivable-${doc.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.Drivable")}</label>
         </div>
         <div class="detailsInput flexitem-full siege-rotatable-toggle" style="${enterable ? "" : "display:none;"}">
            <input type="checkbox" id="siege-rotatable-${doc.id}" class="siege-rotatable-checkbox siege-checkbox" ${rotatable ? "checked" : ""} ${drivable ? "disabled" : ""}>
            <label for="siege-rotatable-${doc.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.Rotatable")}</label>
         </div>
         <div class="detailsInput flexitem-full siege-target-crewmembers-toggle" style="${enterable ? "" : "display:none;"}">
            <input type="checkbox" id="siege-target-crewmembers-${doc.id}" class="siege-target-crewmembers-checkbox siege-checkbox" ${allowCrewTargeting ? "checked" : ""}>
            <label for="siege-target-crewmembers-${doc.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.AllowCrewTargeting")}</label>
         </div>
      `)

      html.find(".siege-enterable-checkbox").on("change", async (e) => {
         const on = e.target.checked
         const update = { [`flags.${MODULE_ID}.enterable`]: on }
         if (!on) {
            update[`flags.${MODULE_ID}.drivable`] = false
            update[`flags.${MODULE_ID}.rotatable`] = false
            update[`flags.${MODULE_ID}.allowCrewTargeting`] = false
         }
         await doc.update(update)
      })

      html.find(".siege-drivable-checkbox").on("change", async (e) => {
         const on = e.target.checked
         
         await doc.update({
            [`flags.${MODULE_ID}.drivable`]: on,
            [`flags.${MODULE_ID}.rotatable`]: on
               ? true
               : !!doc.getFlag(MODULE_ID, "rotatable"),
         })
      })

      html.find(".siege-rotatable-checkbox").on("change", async (e) => {
         await doc.update({
            [`flags.${MODULE_ID}.rotatable`]: e.target.checked,
         })
      })

      html.find(".siege-target-crewmembers-checkbox").on("change", async (e) => {
         await doc.update({
            [`flags.${MODULE_ID}.allowCrewTargeting`]: e.target.checked,
         })
      })
   }

   static _transformToSiegeWeapon(app, html) {
      html.find(".char-level .level label").text(tKey("Sheet.ItemLabel"))
      this._rebuildVehicleStatLayout(app, html)
      this._injectSaves(app, html)
      this._transformInventoryToAmmunition(app, html)
      this._cleanActionsTab(app, html)
      this._injectBulk(app, html)
      this._injectLoadBulkGauge(app, html)
      this._cleanVehicleProperties(html)
      this._injectCustomTabs(app, html)
   }

static _transformEnterableVehicle(app, html) {
      html.find(".char-level .level label").text(tKey("Sheet.VehicleLabel"))
      this._rebuildVehicleStatLayout(app, html)
      this._injectSaves(app, html)
      this._cleanActionsTab(app, html)
      this._injectBulk(app, html)
      this._injectLoadBulkGauge(app, html)
      this._cleanVehicleProperties(html)
      this._injectCustomTabs(app, html)
   }


   static _cleanActionsTab(app, html) {
      if (html.find(".siege-attacks-header").length > 0) return
      const actionsTab = html.find(".tab.actions")
      actionsTab.find("header.action-header").each(function () {
         if (
            ["Reactions", "Free Actions"].some((t) =>
               $(this).text().includes(t),
            )
         ) {
            $(this).next("ol").remove()
            $(this).remove()
         }
      })

      const actionsList = actionsTab.find(".actions-panels ol").first()
      const allActions = actionsList.children(".item").detach()

      const attacksLabel = tKey("Sheet.AttacksHeader")
      const actionsLabel = tKey("Sheet.ActionsHeader")
      const createAttack = tKey("Sheet.CreateAttack")
      const createAction = tKey("Sheet.CreateAction")

      actionsTab.find(".actions-panels").empty().append(`
            <header class="action-header siege-attacks-header">${attacksLabel}
                <div class="controls"><button type="button" class="add-siege-action" data-attack="true"><i class="fa-solid fa-fw fa-plus"></i>${createAttack}</button></div>
            </header>
            <ol class="actions-list siege-attacks-list"></ol>
            <header class="action-header siege-actions-header">${actionsLabel}
                <div class="controls"><button type="button" class="add-siege-action" data-attack="false"><i class="fa-solid fa-fw fa-plus"></i>${createAction}</button></div>
            </header>
            <ol class="actions-list siege-regular-actions-list"></ol>
      `)

      const attacksListDOM = actionsTab.find(".siege-attacks-list")
      const actionsListDOM = actionsTab.find(".siege-regular-actions-list")
      const postLabel = tKey("Buttons.PostToChat")

      allActions.each(function () {
         const itemId = $(this).attr("data-item-id")
         const item = app.document.items.get(itemId)
         const flag = item?.getFlag(MODULE_ID, "siegeAction")
         const disabledReason = actionDisabledReason(flag)
         if (disabledReason) {
            $(this)
               .addClass("siege-action-disabled")
               .attr("data-tooltip", disabledReason)
         }

         const controls = $(this).find(".item-controls")
         controls.prepend(
            `<a class="item-control siege-manual-roll" title="${postLabel}"><i class="fa-solid fa-message"></i></a>`,
         )

         if (flag?.isAttack || flag?.isStrike) attacksListDOM.append(this)
         else actionsListDOM.append(this)
      })

      html.find(".siege-manual-roll").on("click", async (e) => {
         e.preventDefault()
         const itemId = $(e.currentTarget).closest(".item").data("item-id")
         const item = app.document.items.get(itemId)
         const disabledReason = actionDisabledReason(item)
         if (disabledReason) {
            ui.notifications.warn(disabledReason)
            return
         }
         if (item) item.toMessage(e)
      })

      html.find(".add-siege-action").on("click", (e) => {
         e.preventDefault()
         const isAttack = $(e.currentTarget).data("attack")
         import("../managers/actions.mjs").then((m) =>
            m.SiegeActionsManager.showBuilderDialog(app.document, isAttack),
         )
      })
   }


   static _cleanVehicleProperties(html) {
      html.find(".vehicle-properties .detailsInput").each(function () {
         const keep =
            $(this).hasClass("siege-weapon-toggle") ||
            $(this).hasClass("siege-needs-ignition-toggle") ||
            $(this).hasClass("siege-mountable-toggle") ||
            $(this).hasClass("siege-drivable-toggle") ||
            $(this).hasClass("siege-rotatable-toggle") ||
            $(this).hasClass("siege-target-crewmembers-toggle") ||
            $(this).find(".details-label").text().trim() === "Traits"
         if (!keep) $(this).remove()
      })
   }

   static _injectCustomTabs(app, html) {
      if (app._siegeActiveTab === undefined) {
         app._siegeActiveTab = app._tabs?.[0]?.active ?? "description"
      }

      html.on("click", "nav .item, nav [data-tab]", (ev) => {
         app._siegeActiveTab = $(ev.currentTarget).data("tab")
      })

      if (html.find('a[data-tab="crew"]').length === 0) {
         html
            .find('a[data-tab="description"]')
            .before(
               `<a class="item" data-tab="crew" data-tooltip="${tKey("Tabs.Crew")}"><i class="fa-solid fa-users"></i></a><a class="item" data-tab="sfx" data-tooltip="${tKey("Tabs.SFX")}"><i class="fa-solid fa-music"></i></a>`,
            )
         html
            .find(".sheet-content")
            .append(
               `<div class="tab crew" data-tab="crew"><h2>${tKey("Crew.Title")}</h2></div><div class="tab sfx" data-tab="sfx"><h2>${tKey("SFX.GlobalHeader")}</h2></div>`,
            )
      }
      html.find('a[data-tab="crew"]').attr("data-tooltip", tKey("Tabs.Crew"))
      html.find('a[data-tab="sfx"]').attr("data-tooltip", tKey("Tabs.SFX"))

      Hooks.callAll("pf2e-aztecs-siege.vehicleSheetTabsReady", app, html, app.actor)

      const activeTab = String(app._siegeActiveTab || "")
      const activeTabExists =
         activeTab &&
         html.find(`a.item[data-tab="${activeTab}"]`).length &&
         html.find(`.tab[data-tab="${activeTab}"]`).length
      if (activeTabExists) {
         html.find(".tab, a.item[data-tab]").removeClass("active")
         html.find(`[data-tab="${activeTab}"]`).addClass("active")
         if (app._tabs?.[0]) app._tabs[0].active = app._siegeActiveTab
      }
   }
}

Object.assign(
   SiegeSheetUI,
   sheetAmmunitionMethods,
   sheetSavesBulkMethods,
)
