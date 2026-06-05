import { MODULE_ID, DC_BY_LEVEL, D20_SVG } from "../constants.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { VehicleLoadManager } from "../managers/vehicle-load.mjs"
import {
   clampLevel,
   isSiege,
   isEnterableVehicle,
   slugify,
   tKey,
} from "../utils.mjs"
import { SiegeSFXManager } from "../managers/sfx.mjs"
import { ammoTypesAccordionHTML } from "./ammo-details.mjs"

export class SiegeSheetUI {
   static renderSheet(app, html, data) {
      if (app.document.type !== "vehicle") return
      const isSiegeWeapon = isSiege(app.document)
      this._compactDimensionInputs(app, html)
      this._injectToggle(app, html, isSiegeWeapon)
      if (isSiegeWeapon) {
         this._transformToSiegeWeapon(app, html)
         SiegeSFXManager.buildTabUI(app, html)
      } else if (isEnterableVehicle(app.document)) {
         this._transformEnterableVehicle(app, html)
         SiegeSFXManager.buildTabUI(app, html)
      }
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
            await app.document.update({
               [`flags.${MODULE_ID}.isSiegeWeapon`]: e.target.checked,
            })
         })
      }

      this._injectEnterableToggles(app, html, isSiegeWeapon)

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
            <label for="siege-drivable-${doc.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.Drivable")} ${info("Sheet.DrivableTooltip")}</label>
         </div>
         <div class="detailsInput flexitem-full siege-rotatable-toggle" style="${enterable ? "" : "display:none;"}">
            <input type="checkbox" id="siege-rotatable-${doc.id}" class="siege-rotatable-checkbox siege-checkbox" ${rotatable ? "checked" : ""} ${drivable ? "disabled" : ""}>
            <label for="siege-rotatable-${doc.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.Rotatable")} ${info("Sheet.RotatableTooltip")}</label>
         </div>
      `)

      html.find(".siege-enterable-checkbox").on("change", async (e) => {
         const on = e.target.checked
         const update = { [`flags.${MODULE_ID}.enterable`]: on }
         if (!on) {
            update[`flags.${MODULE_ID}.drivable`] = false
            update[`flags.${MODULE_ID}.rotatable`] = false
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

   static _transformInventoryToAmmunition(app, html) {
      
      
      const navInv = html.find('.sheet-navigation a[data-tab="inventory"]')
      if (navInv.length > 0) {
         navInv.attr("data-tooltip", tKey("Tabs.Stash"))
         navInv.html('<i class="fa-solid fa-box-archive"></i>')
      }

      
      const weaponRows = this._weaponryRowsForSheet(app.document)
      const isGM = game.user.isGM
      const reloadListHtml = weaponRows.length
         ? `<ul class="items siege-weaponry-list">${weaponRows
              .map(
                 (w) => `
            <li class="item siege-weapon-row" data-action-id="${w.id}">
               <img class="siege-weapon-icon" src="${w.img}">
               <span class="siege-weapon-name">${w.name}</span>
               ${
                  w.usesAmmunition
                     ? `<a class="siege-weapon-ammo siege-sheet-ammo-types" data-action-id="${w.id}">${tKey("Weaponry.AmmunitionTypes")}</a>`
                     : `<span class="siege-weapon-ammo">${tKey("Weaponry.NoAmmunition")}</span>`
               }
               ${
                  w.usesAmmunition
                     ? `<span class="siege-weapon-count">${w.loaded} / ${w.max}</span>`
                     : ""
               }
               ${
                  isGM && w.usesAmmunition
                     ? `<a class="siege-sheet-reload" data-action-id="${w.id}" data-tooltip="${tKey("Weaponry.Reload")}"><i class="fa-solid fa-rotate"></i></a>
                        <a class="siege-sheet-switch-loaded" data-action-id="${w.id}" ${w.canSwitch ? "" : "disabled"} data-tooltip="${tKey("Weaponry.SwitchLoaded")}"><i class="fa-solid fa-arrow-right-arrow-left"></i></a>
                        <a class="siege-sheet-unload" data-action-id="${w.id}" data-tooltip="${tKey("Weaponry.Unload")}"><i class="fa-solid fa-arrow-down"></i></a>`
                     : ""
               }
            </li>`,
              )
              .join("")}</ul>`
         : `<p class="notes">${tKey("VehicleHUD.NoWeaponry")}</p>`

      const ammoTypes = app.document.getFlag(MODULE_ID, "ammunitionTypes") || []
      const phName = tKey("Ammunition.Name")
      const phSlug = tKey("Ammunition.Slug")
      const defaultAmmoIcon = "icons/svg/target.svg"

      const typesListHtml = ammoTypes
         .map(
            (type, index) => `
         <li class="item ammo-type-row" data-index="${index}">
            <div class="ammo-inputs">
               <a class="ammo-type-icon" data-index="${index}" data-tooltip="${tKey("Ammunition.IconTooltip")}"><img src="${type.img || defaultAmmoIcon}" alt=""></a>
               <input type="text" class="ammo-input-text ammo-type-name" placeholder="${phName}" value="${type.name ?? ""}">
               <input type="text" class="ammo-input-text ammo-type-slug" placeholder="${phSlug}" value="${type.slug ?? ""}">
               <a class="remove-ammo-type" data-tooltip="${tKey("Ammunition.Remove")}"><i class="fa-solid fa-trash"></i></a>
            </div>
         </li>
      `,
         )
         .join("")

      
      if (html.find('a[data-tab="weaponry"]').length === 0) {
         const navTarget = navInv.length
            ? navInv
            : html.find('.sheet-navigation a[data-tab="actions"]')
         navTarget.before(
            `<a class="item" data-tab="weaponry" data-tooltip="${tKey("Tabs.Weaponry")}"><i class="fa-solid fa-crosshairs"></i></a>`,
         )
      }
      if (html.find('.tab.weaponry[data-tab="weaponry"]').length === 0) {
         const body = `
            <div class="tab weaponry siege-weaponry-tab" data-tab="weaponry">
               <div class="siege-weaponry-panel">
                  <header class="siege-header-alt"><h3>${tKey("Tabs.Weaponry")}</h3></header>
                  ${reloadListHtml}
                  <div class="siege-ammo-types-dropzone">
                     <header class="siege-header-alt siege-ammo-types-header">
                        <h3>${tKey("Ammunition.TypesHeader")}</h3>
                        <a class="add-ammo-type" data-tooltip="${tKey("Ammunition.Add")}"><i class="fa-solid fa-plus"></i></a>
                     </header>
                     <p class="siege-ammo-droptip"><i class="fa-solid fa-arrow-down-to-bracket"></i> ${tKey("Ammunition.DropTip")}</p>
                     <ul class="items siege-ammo-types-list">${typesListHtml}</ul>
                  </div>
               </div>
            </div>`
         const content = html.find(".sheet-content")
         if (content.length) content.append(body)
         else html.find(".tab.inventory").after(body)
      }

      const weaponryTab = html.find('.tab.weaponry[data-tab="weaponry"]')
      this._bindAmmoListeners(app, weaponryTab)
      this._bindSheetReloadListeners(app, weaponryTab)
   }

   
   static _weaponryRowsForSheet(vehicle) {
      const rows = []
      const actions = vehicle.items.filter((i) => i.type === "action")
      for (const a of actions) {
         const flag = a.getFlag(MODULE_ID, "siegeAction") || {}
         if (!(flag.isStrike || flag.isAttack)) continue
         const usesAmmunition = flag.usesAmmunition !== false
         const max = parseInt(flag.maxLoaded) || 1
         const loaded = AmmunitionManager.getStrikeLoaded(vehicle, a)
         const ammoChoices = usesAmmunition
            ? AmmunitionManager.ammoTypesForAction(vehicle, flag)
            : []
         const active = AmmunitionManager.getActiveLoadedPiece(vehicle, a)
         const ammoDetail =
            ammoChoices.length > 0
               ? AmmunitionManager.weaponryAmmoDetail(vehicle, a)
               : ""
         const ammoName =
            active?.name ||
            ammoChoices.map(({ type }) => type.name).join(" / ") ||
            tKey("Ammunition.TypeUnassigned")
         rows.push({
            id: a.id,
            name: a.name,
            img: a.img || "icons/svg/target.svg",
            ammoName,
            usesAmmunition,
            usesCharges: !!active?.usesCharges,
            canSwitch: AmmunitionManager.canSwitchLoadedAmmo(vehicle, a),
            ammoDetail,
            loaded,
            max,
         })
      }
      return rows
   }

   static async _showSheetAmmoTypesDialog(vehicle, action) {
      const content = `<div class="siege-sheet-ammo-dialog">
         ${ammoTypesAccordionHTML(vehicle, action)}
      </div>`
      await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog", "siege-actions-app"],
         window: {
            title: `${action.name} - ${tKey("Weaponry.AmmunitionTypes")}`,
         },
         position: { width: 520 },
         content,
         buttons: [{ action: "close", label: tKey("CrewHUD.Cancel"), default: true }],
      }).catch(() => null)
   }

   static _bindSheetReloadListeners(app, invTab) {
      const vehicle = app.document
      const prompt = async (action, mode) => {
         const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
         const slug =
            mode === "reload"
               ? AmmunitionManager.primaryAmmoSlugForAction(flag)
               : AmmunitionManager.activeAmmoSlug(vehicle, action)
         const max = parseInt(flag.maxLoaded) || 1
         const loaded = AmmunitionManager.getStrikeLoaded(vehicle, action)
         let cap
         if (mode === "reload") {
            if (!slug || !AmmunitionManager.ammoTypeFor(vehicle, slug)) {
               ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
               return null
            }
            const replacingCharged =
               AmmunitionManager.reloadNeedsChargedReplacement(vehicle, action)
            cap = replacingCharged
               ? Math.min(1, AmmunitionManager.getAvailableLoadUnits(vehicle, slug))
               : Math.min(
                    max - loaded,
                    AmmunitionManager.ammoUsesCharges(vehicle, slug)
                       ? AmmunitionManager.getAvailableLoadUnits(vehicle, slug)
                       : AmmunitionManager.getAvailableUnits(vehicle, slug),
                 )
         } else cap = loaded
         if (cap <= 0) {
            ui.notifications.warn(
               mode === "reload"
                  ? tKey("Notifications.InsufficientAmmo")
                  : tKey("Weaponry.NothingLoaded"),
            )
            return null
         }
         const title = mode === "reload" ? tKey("Weaponry.Reload") : tKey("Weaponry.Unload")
         const v = await foundry.applications.api.DialogV2.wait({
            classes: ["siege-v2-dialog"],
            window: { title: `${title} — ${action.name}` },
            content: `<div style="padding:6px;"><input type="number" class="siege-amt" value="${cap}" min="1" max="${cap}" style="width:100%;"></div>`,
            buttons: [
               {
                  action: "ok",
                  label: title,
                  default: true,
                  callback: (e, b, d) => {
                     const el = (d?.element ?? document).querySelector(".siege-amt")
                     return Math.max(1, Math.min(cap, parseInt(el?.value) || 1))
                  },
               },
               { action: "cancel", label: tKey("CrewHUD.Cancel") },
            ],
         }).catch(() => null)
         return v ?? null
      }

      invTab.find(".siege-sheet-ammo-types").on("click", async (e) => {
         e.preventDefault()
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         await this._showSheetAmmoTypesDialog(vehicle, action)
      })

      invTab.find(".siege-sheet-reload").on("click", async (e) => {
         e.preventDefault()
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         const active = AmmunitionManager.getActiveLoadedPiece(vehicle, action)
         const usesCharges = !!active?.usesCharges
         const multiType =
            AmmunitionManager.ammoSlugsForAction(
               action.getFlag(MODULE_ID, "siegeAction") || {},
            ).length > 1
         const amt = usesCharges || multiType ? null : await prompt(action, "reload")
         if (!usesCharges && !multiType && amt === null) return
         await AmmunitionManager.reloadStrike(vehicle, action, amt)
         app.render(false)
      })

      invTab.find(".siege-sheet-switch-loaded").on("click", async (e) => {
         e.preventDefault()
         if ($(e.currentTarget).attr("disabled") !== undefined) return
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         await AmmunitionManager.switchActiveLoadedAmmo(vehicle, action)
         app.render(false)
      })

      invTab.find(".siege-sheet-unload").on("click", async (e) => {
         e.preventDefault()
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         const active = AmmunitionManager.getActiveLoadedPiece(vehicle, action)
         const usesCharges = !!active?.usesCharges
         const amt = usesCharges ? null : await prompt(action, "unload")
         if (!usesCharges && amt === null) return
         await AmmunitionManager.unloadStrike(vehicle, action, amt)
         app.render(false)
      })
   }

   static _bindAmmoListeners(app, invTab) {
      const getTypes = () => [
         ...(app.document.getFlag(MODULE_ID, "ammunitionTypes") || []),
      ]
      const saveTypes = async (data) => {
         await app.document.setFlag(MODULE_ID, "ammunitionTypes", data)
         app.render(false)
      }

      invTab.find(".add-ammo-type").on("click", async (e) => {
         e.preventDefault()
         const types = getTypes()
         types.push({ name: "", slug: "", img: "" })
         await saveTypes(types)
      })

      invTab.find(".remove-ammo-type").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("Ammunition.RemoveTitle") },
            content: `<p>${tKey("Ammunition.RemoveConfirm")}</p>`,
            rejectClose: false,
         })
         if (!confirmed) return

         const index = $(e.currentTarget)
            .closest(".ammo-type-row")
            .data("index")
         const types = getTypes()
         types.splice(index, 1)
         await saveTypes(types)
      })

      
      invTab.find(".ammo-type-icon").on("click", (e) => {
         e.preventDefault()
         const index = Number($(e.currentTarget).data("index"))
         const types = getTypes()
         const FP =
            foundry.applications?.apps?.FilePicker?.implementation ||
            globalThis.FilePicker
         const fp = new FP({
            type: "image",
            current: types[index]?.img || "",
            callback: async (path) => {
               const t = getTypes()
               if (!t[index]) return
               t[index].img = path
               await saveTypes(t)
            },
         })
         fp.render(true)
      })

      invTab.find(".ammo-type-name").on("input", (e) => {
         const row = $(e.currentTarget).closest(".ammo-type-row")
         const slugInput = row.find(".ammo-type-slug")
         const currentSlug = (slugInput.val() || "").trim()
         const previousName = e.currentTarget.dataset.lastValue ?? ""
         const previousAutoSlug = slugify(previousName)
         if (currentSlug === "" || currentSlug === previousAutoSlug)
            slugInput.val(slugify(e.currentTarget.value))
         e.currentTarget.dataset.lastValue = e.currentTarget.value
      })

      invTab
         .find(".ammo-type-name, .ammo-type-slug")
         .on("change", async (e) => {
            e.preventDefault()
            const row = $(e.currentTarget).closest(".ammo-type-row")
            const index = row.data("index")
            const types = getTypes()
            if (!types[index]) return
            types[index] = {
               ...types[index],
               name: row.find(".ammo-type-name").val(),
               slug: row.find(".ammo-type-slug").val(),
            }
            await saveTypes(types)
         })

      const readDropData = (event) => {
         try {
            const data =
               foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData?.(
                  event,
               )
            if (data) return data
         } catch {
            
         }
         const tryParse = (raw) => {
            if (!raw) return null
            try {
               return JSON.parse(raw)
            } catch {
               return null
            }
         }
         return (
            tryParse(event.dataTransfer.getData("text/plain")) ||
            tryParse(event.dataTransfer.getData("text/json")) ||
            tryParse(event.dataTransfer.getData("application/json"))
         )
      }

      const resolveDroppedItem = async (data) => {
         if (!data || data.type !== "Item") return null
         if (data.uuid || data.documentUuid)
            return fromUuid(data.uuid || data.documentUuid)
         if (data.id) {
            const worldItem = game.items.get(data.id)
            if (worldItem) return worldItem
            const actor = data.actorId ? game.actors.get(data.actorId) : null
            if (actor) return actor.items.get(data.id) || null
         }
         return null
      }

      
      const dropZone = invTab.find(".siege-ammo-types-dropzone").get(0)
      if (dropZone) {
         dropZone.addEventListener("dragover", (e) => {
            e.preventDefault()
            e.stopPropagation()
            dropZone.classList.add("siege-ammo-dragover")
         })
         dropZone.addEventListener("dragleave", () =>
            dropZone.classList.remove("siege-ammo-dragover"),
         )
         dropZone.addEventListener("drop", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation?.()
            dropZone.classList.remove("siege-ammo-dragover")
            const data = readDropData(e)
            const item = await resolveDroppedItem(data)
            if (!item) return
            
            const { AmmunitionManager } = await import(
               "../managers/ammunition.mjs"
            )
            if (!AmmunitionManager.isAmmoItem(item)) {
               ui.notifications.warn(tKey("Ammunition.NotAmmo"))
               return
            }
            const slug = item.system?.slug || slugify(item.name)
            const types = getTypes()
            if (types.some((t) => slugify(t.slug || t.name) === slugify(slug))) {
               ui.notifications.info(tKey("Ammunition.AlreadyExists"))
               return
            }
            types.push({ name: item.name, slug, img: item.img || "" })
            await saveTypes(types)
            ui.notifications.info(
               tKey("Ammunition.Created", { name: item.name }),
            )
         })
      }
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

   static _injectSaves(app, html) {
      if (html.find(".sidebar-saves").find('[data-save="reflex"]').length > 0)
         return

      const refVal = app.document.getFlag(MODULE_ID, "saves.reflex.value") || 0
      const willVal = app.document.getFlag(MODULE_ID, "saves.will.value") || 0

      const refLabel = tKey("Attributes.Reflex")
      const willLabel = tKey("Attributes.Will")

      html.find(".sidebar-saves").append(`
         <li class="roll-data" data-save="reflex">
            <h2 class="sidebar_label">${refLabel}</h2>
            <div class="save-roll">
               <a class="roll-icon custom-siege-save" data-save="reflex">
                  <div class="d20-svg">${D20_SVG}</div>
               </a>
               <input class="adjustable" name="flags.${MODULE_ID}.saves.reflex.value" type="number" value="${refVal}">
            </div>
         </li>
         <li class="roll-data" data-save="will">
            <h2 class="sidebar_label">${willLabel}</h2>
            <div class="save-roll">
               <a class="roll-icon custom-siege-save" data-save="will">
                  <div class="d20-svg">${D20_SVG}</div>
               </a>
               <input class="adjustable" name="flags.${MODULE_ID}.saves.will.value" type="number" value="${willVal}">
            </div>
         </li>
      `)

      html.find(".custom-siege-save").on("click", async (e) => {
         e.preventDefault()
         const saveType = $(e.currentTarget).data("save")
         const mod =
            parseInt(
               app.document.getFlag(MODULE_ID, `saves.${saveType}.value`),
            ) || 0
         const label =
            saveType === "reflex"
               ? tKey("Attributes.Reflex")
               : tKey("Attributes.Will")
         const title = tKey("Saves.Title", { name: label })

         try {
            const modifiers = [
               new game.pf2e.Modifier({
                  slug: "base",
                  label: tKey("Modifiers.Base"),
                  modifier: mod,
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
            const roll = new Roll(`1d20 + ${mod}`)
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
      const bulkTooltip = tKey("Sheet.BulkTooltip")
      const bulkValue = app.document.getFlag(MODULE_ID, "bulk") || 0
      return `
         <div class="siege-bulk-col siege-portable-bulk">
            <label class="details-label siege-bulk-label">
               ${bulkLabel}
               <i class="fa-solid fa-circle-info" data-tooltip="${bulkTooltip}" data-tooltip-direction="UP"></i>
            </label>
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

   static _cleanVehicleProperties(html) {
      html.find(".vehicle-properties .detailsInput").each(function () {
         const keep =
            $(this).hasClass("siege-weapon-toggle") ||
            $(this).hasClass("siege-needs-ignition-toggle") ||
            $(this).hasClass("siege-mountable-toggle") ||
            $(this).hasClass("siege-drivable-toggle") ||
            $(this).hasClass("siege-rotatable-toggle") ||
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
               `<a class="item" data-tab="crew"><i class="fa-solid fa-users"></i></a><a class="item" data-tab="sfx"><i class="fa-solid fa-music"></i></a>`,
            )
         html
            .find(".sheet-content")
            .append(
               `<div class="tab crew" data-tab="crew"><h2>${tKey("Crew.Title")}</h2></div><div class="tab sfx" data-tab="sfx"><h2>${tKey("SFX.GlobalHeader")}</h2></div>`,
            )
      }

      if (["crew", "sfx", "ammunition", "weaponry"].includes(app._siegeActiveTab)) {
         html.find(".tab, a.item[data-tab]").removeClass("active")
         html.find(`[data-tab="${app._siegeActiveTab}"]`).addClass("active")
         if (app._tabs?.[0]) app._tabs[0].active = app._siegeActiveTab
      }
   }
}
