import { MODULE_ID, SIZE_BULK } from "../constants.mjs"
import { isSiege, tKey } from "../utils.mjs"

const HAULING_IMG = "icons/svg/anchor.svg"

export class HaulManager {
   static _operationQueue = new Map()

   static async enqueue(haulerId, func) {
      if (!haulerId) return
      const current = this._operationQueue.get(haulerId) || Promise.resolve()
      const next = current.then(() => func()).catch(() => {})
      this._operationQueue.set(haulerId, next)
      return next
   }

   static initHooks() {
      Hooks.on("preUpdateToken", (tokenDoc, changes, options) =>
         this._onPreUpdateToken(tokenDoc, changes, options),
      )
      Hooks.on("updateToken", (tokenDoc, changes, options, userId) =>
         this._onUpdateToken(tokenDoc, changes, options, userId),
      )
      Hooks.on("deleteItem", (item, options, userId) =>
         this._onDeleteItem(item, options, userId),
      )

Hooks.on("updateActor", (actor, changes) => {
         if (!game.user.isGM) return
         const sizeChanged =
            foundry.utils.getProperty(changes, "system.traits.size") !==
            undefined
         if (sizeChanged && this._isHauled(actor))
            this._recalcHauledTarget(actor)
      })
      const invItemHook = (item) => {
         if (!game.user.isGM) return
         const actor = item?.parent
         if (!(actor instanceof Actor)) return
         if (item.getFlag?.(MODULE_ID, "isHauledItem")) return 
         if (this._isHauled(actor)) this._recalcHauledTarget(actor)
      }
      Hooks.on("createItem", invItemHook)
      Hooks.on("updateItem", invItemHook)
      Hooks.on("deleteItem", (item, options) => {
         if (options.haulCascade) return
         invItemHook(item)
      })
   }

static _isHauled(actor) {
      return actor?.itemTypes?.effect?.some((e) =>
         e.getFlag(MODULE_ID, "isHauled"),
      )
   }

static async _recalcHauledTarget(target) {
      const eff = target.itemTypes.effect.find((e) =>
         e.getFlag(MODULE_ID, "isHauled"),
      )
      if (!eff) return
      const haulerId = eff.getFlag(MODULE_ID, "haulerId")
      const hauler = this._resolveActor(haulerId)
      if (!hauler) return

      await this.enqueue(haulerId, async () => {

const existingMain = hauler.items.find(
            (i) =>
               i.getFlag(MODULE_ID, "isHauledItem") &&
               i.getFlag(MODULE_ID, "hauledActorId") === target.id,
         )
         let coef =
            eff.getFlag(MODULE_ID, "haulCoef") ??
            existingMain?.getFlag(MODULE_ID, "haulCoef") ??
            1
         if (!Number.isFinite(coef) || coef <= 0) coef = 1

const old = hauler.items.filter(
            (i) =>
               i.getFlag(MODULE_ID, "isHauledItem") &&
               i.getFlag(MODULE_ID, "hauledActorId") === target.id,
         )
         if (old.length > 0)
            await hauler.deleteEmbeddedDocuments(
               "Item",
               old.map((i) => i.id),
               { haulCascade: true },
            )

const b = this._computeHauledBulk(target, coef)
         const img = target.prototypeToken?.texture?.src || target.img
         await this._createHauledItems(hauler, target, b, img, coef)
         await this._refreshHaulingEffect(hauler)
      })
   }

static async _createHauledItems(hauler, target, breakdown, img, coef = 1) {
      const combined =
         Math.round((breakdown.wholeBulk + breakdown.lightCount * 0.1) * 10) / 10
      const label =
         breakdown.lightCount > 0
            ? tKey("Haul.HauledItemWithLight", {
                 name: target.name,
                 bulk: breakdown.wholeBulk,
                 light: breakdown.lightCount,
              })
            : tKey("Haul.HauledItem", { name: target.name })
      await hauler.createEmbeddedDocuments("Item", [
         {
            name: label,
            type: "equipment",
            img,
            system: {
               quantity: 1,
               description: {
                  value: tKey("Haul.HauledItemDesc", { name: target.name }),
               },
               bulk: { value: combined },
               size: "med",
            },
            flags: {
               [MODULE_ID]: {
                  isHauledItem: true,
                  haulerId: hauler.id,
                  hauledActorId: target.id,
                  intendedBulk: breakdown.wholeBulk,
                  intendedLightCount: breakdown.lightCount,
                  haulCoef: coef,
               },
            },
         },
      ])
   }

static sizeBulk(actor) {
      const size = actor?.system?.traits?.size?.value || "med"
      return SIZE_BULK[size] ?? SIZE_BULK.med
   }

static _isVehicleWithBulkFlag(actor) {
      return actor?.type === "vehicle"
   }

static _flagBulk(actor) {
      return parseInt(actor?.getFlag?.(MODULE_ID, "bulk")) || 0
   }

static _computeHauledBulk(actor, coef = 1) {
      const isVehicle = this._isVehicleWithBulkFlag(actor)
      const flagBulk = this._flagBulk(actor)
      const sizeBulkVal = this.sizeBulk(actor)

      if (isVehicle) {
         const base = flagBulk > 0 ? flagBulk : sizeBulkVal
         return {
            isVehicle,
            flagBulk,
            sizeBulkVal,
            invComputed: 0,
            invLightCount: 0,
            invWhole: 0,
            wholeBulk: Math.round(base * coef),
            lightCount: 0,
         }
      }

      const invComputed = this.inventoryBulk(actor)
      const invLightCount = this.lightItemCount(actor)
      const invWhole = Math.max(0, Math.round(invComputed - invLightCount * 0.1))
      const wholeBulk = Math.round((sizeBulkVal + invWhole) * coef)
      const lightCount = Math.round(invLightCount * coef)
      return {
         isVehicle,
         flagBulk,
         sizeBulkVal,
         invComputed,
         invLightCount,
         invWhole,
         wholeBulk,
         lightCount,
      }
   }

static lightItemCount(actor) {
      let count = 0
      for (const item of this._physicalItems(actor)) {
         const b = this._perItemBulk(item)
         
         if (b.normal === 0 && b.light > 0) count += b.light
      }
      return count
   }

static _physicalItems(actor) {
      const items = actor?.inventory?.contents ?? actor?.items ?? []
      return [...items].filter((i) => i?.system?.bulk !== undefined)
   }

static _perItemBulk(item) {

const b = item?.bulk
      if (b && (typeof b.normal === "number" || typeof b.light === "number")) {
         return { normal: Number(b.normal) || 0, light: Number(b.light) || 0 }
      }
      
      const raw = this._itemBulkValue(item)
      const qty = Number(item.system?.quantity ?? 1) || 1
      const totalTenths = Math.round(raw * 10) * qty
      return {
         normal: Math.floor(totalTenths / 10),
         light: totalTenths % 10,
      }
   }

static inventoryBulk(actor) {
      const computed = actor?.inventory?.bulk
      
      if (
         computed &&
         (typeof computed.normal === "number" ||
            typeof computed.light === "number")
      ) {
         const normal = Number(computed.normal) || 0
         const light = Number(computed.light) || 0
         const total = normal + light * 0.1
         return total
      }
      const val = computed?.value
      if (typeof val === "number") {
         return val
      }

let tenths = 0
      for (const item of this._physicalItems(actor)) {
         const b = this._perItemBulk(item)
         tenths += b.normal * 10 + b.light
      }
      const total = tenths / 10
      return total
   }

static _itemBulkValue(item) {
      const raw = item.system?.bulk?.value ?? item.system?.bulk
      if (typeof raw === "number") return raw
      if (raw && typeof raw === "object") {
         if (typeof raw.value === "number") return raw.value
         const normal = Number(raw.normal) || 0
         const light = Number(raw.light) || 0
         return normal + light * 0.1
      }
      return 0
   }

static selfBulk(actor) {
      if (this._isVehicleWithBulkFlag(actor)) {
         const flag = this._flagBulk(actor)
         return flag > 0 ? flag : this.sizeBulk(actor)
      }
      return this.sizeBulk(actor)
   }

   static targetTotalBulk(actor) {
      if (this._isVehicleWithBulkFlag(actor)) {
         
         return this.selfBulk(actor)
      }
      return this.sizeBulk(actor) + this.inventoryBulk(actor)
   }

   static haulerCapacity(actor) {
      const strMod = actor?.system?.abilities?.str?.mod ?? 0
      const bulkAttr = actor?.system?.attributes?.bulk || {}
      const encumberedAfter = Number(bulkAttr.encumberedAfter) || 5 + strMod
      const maxLimit = Number(bulkAttr.maxLimit ?? bulkAttr.max) || 10 + strMod
      const ownBulk = this.inventoryBulk(actor)
      return { encumberedAfter, maxLimit, ownBulk }
   }

static async haul(hauler, targets, coefficient = 1, elevation = null) {
      if (!hauler || targets.length === 0) return

      const coef = Number(coefficient)
      const safeCoef = Number.isFinite(coef) && coef >= 0 ? coef : 1
      const applyElevation = elevation !== null && elevation !== undefined
      const elevValue = applyElevation ? Number(elevation) || 0 : null

      const haulerToken = hauler.getActiveTokens()[0]
      if (!haulerToken) {
         ui.notifications.warn(tKey("Haul.Notifications.NoHaulerToken"))
         return
      }

      const targetData = []
      for (const t of targets) {
         const token = t.getActiveTokens?.()[0] || t
         const actor = token.actor ?? t
         if (!actor || actor.id === hauler.id) continue
         targetData.push({ actor, token })
      }
      if (targetData.length === 0) return

      const haulerCenter = this._tokenCenter(haulerToken)

for (const { actor, token } of targetData) {
         
         const already = actor.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "isHauled") &&
               e.getFlag(MODULE_ID, "haulerId") === hauler.id,
         )
         if (already) continue

         const center = this._tokenCenter(token)
         const img = actor.prototypeToken?.texture?.src || actor.img

const breakdown = this._computeHauledBulk(actor, safeCoef)
         await this._createHauledItems(hauler, actor, breakdown, img, safeCoef)

const tokenDoc = token.document ?? token
         const priorElevation = tokenDoc.elevation || 0
         if (applyElevation && tokenDoc.update)
            await tokenDoc.update(
               { elevation: elevValue },
               { haulSyncMovement: true },
            )

         await actor.createEmbeddedDocuments("Item", [
            {
               name: tKey("Haul.HauledEffect", { name: hauler.name }),
               type: "effect",
               img: HAULING_IMG,
               system: {
                  description: {
                     value: tKey("Haul.HauledDesc", { name: hauler.name }),
                  },
                  tokenIcon: { show: false },
               },
               flags: {
                  [MODULE_ID]: {
                     isHauled: true,
                     haulerId: hauler.id,
                     offsetX: center.x - haulerCenter.x,
                     offsetY: center.y - haulerCenter.y,
                     appliedElevation: applyElevation ? elevValue : null,
                     priorElevation,
                     haulCoef: safeCoef,
                  },
               },
            },
         ])
      }

      await this._refreshHaulingEffect(hauler)
      const names = this._hauledNames(hauler).join(", ")
      ui.notifications.info(tKey("Haul.Notifications.Started", { targets: names }))
   }

static _hauledNames(hauler) {
      const names = []
      for (const item of hauler.items) {
         if (item.getFlag(MODULE_ID, "isHauledItem")) {
            const id = item.getFlag(MODULE_ID, "hauledActorId")
            const actor = this._resolveActor(id)
            names.push(actor?.name || item.name)
         }
      }
      return names
   }

   static _hauledItemCount(hauler) {
      return hauler.items.filter((i) => i.getFlag(MODULE_ID, "isHauledItem"))
         .length
   }

static async _refreshHaulingEffect(hauler) {
      const names = this._hauledNames(hauler)
      const existing = hauler.itemTypes.effect.find((e) =>
         e.getFlag(MODULE_ID, "isHauling"),
      )

      if (names.length === 0) {
         if (existing)
            await hauler.deleteEmbeddedDocuments("Item", [existing.id], {
               haulCascade: true,
            })
         return
      }

      const label = tKey("Haul.HaulingEffect", { targets: names.join(", ") })
      const desc = tKey("Haul.HaulingDesc", { targets: names.join(", ") })
      if (!existing) {
         await hauler.createEmbeddedDocuments("Item", [
            {
               name: label,
               type: "effect",
               img: HAULING_IMG,
               system: {
                  description: { value: desc },
                  tokenIcon: { show: false },
               },
               flags: { [MODULE_ID]: { isHauling: true, haulerId: hauler.id } },
            },
         ])
      } else if (existing.name !== label) {
         await existing.update(
            { name: label, "system.description.value": desc },
            { haulCascade: true },
         )
      }
   }

static async _postFallMessage(target, hauler, feet) {
      const link =
         "@UUID[Compendium.pf2e.journals.JournalEntry.S55aqwWIzpQRFhcq]{Falling}"
      const content = `<p>${tKey("Haul.FellMessage", {
         target: target.name,
         hauler: hauler?.name ?? "",
         feet,
      })} ${link}</p>`
      await ChatMessage.create({
         content,
         speaker: ChatMessage.getSpeaker({ actor: target }),
      })
   }

static _tokenCenter(tokenDoc) {
      const grid = canvas?.grid?.size || canvas?.dimensions?.size || 100
      const doc = tokenDoc.document ?? tokenDoc
      return {
         x: doc.x + (doc.width ?? 1) * grid * 0.5,
         y: doc.y + (doc.height ?? 1) * grid * 0.5,
      }
   }

   static _isHauledToken(actor) {
      return actor?.itemTypes.effect.find((e) =>
         e.getFlag(MODULE_ID, "isHauled"),
      )
   }

   static _onPreUpdateToken(tokenDoc, changes, options) {
      if (
         options.haulSyncMovement ||
         options.siegeEntering ||
         options.siegeExiting ||
         options.siegeSyncMovement
      )
         return
      const actor = tokenDoc.actor
      if (!actor) return
      if (!this._isHauledToken(actor)) return

      const movingX = changes.x !== undefined && changes.x !== tokenDoc.x
      const movingY = changes.y !== undefined && changes.y !== tokenDoc.y
      if (movingX || movingY) {
         ui.notifications.warn(tKey("Haul.Notifications.CannotMoveWhileHauled"))
         if (changes.x !== undefined) changes.x = tokenDoc.x
         if (changes.y !== undefined) changes.y = tokenDoc.y
      }
   }

   static _onUpdateToken(tokenDoc, changes, options, userId) {
      if (game.user.id !== userId || options.haulSyncMovement) return
      const actor = tokenDoc.actor
      if (!actor) return
      const haulingEffect = actor.itemTypes.effect.find((e) =>
         e.getFlag(MODULE_ID, "isHauling"),
      )
      if (!haulingEffect) return

      const movedXY = changes.x !== undefined || changes.y !== undefined
      const movedRot = changes.rotation !== undefined
      if (!movedXY && !movedRot) return

      const grid = canvas?.grid?.size || canvas?.dimensions?.size || 100
      const newX = changes.x !== undefined ? changes.x : tokenDoc.x
      const newY = changes.y !== undefined ? changes.y : tokenDoc.y
      const oldRot = tokenDoc.rotation || 0
      const newRot = changes.rotation !== undefined ? changes.rotation : oldRot
      const deltaRot = ((newRot - oldRot) * Math.PI) / 180

      const newCenter = {
         x: newX + (tokenDoc.width ?? 1) * grid * 0.5,
         y: newY + (tokenDoc.height ?? 1) * grid * 0.5,
      }

      this.enqueue(actor.id, async () => {
         const updates = []
         for (const t of canvas.tokens.placeables) {
            const tActor = t.actor
            if (!tActor) continue
            const eff = tActor.itemTypes.effect.find(
               (e) =>
                  e.getFlag(MODULE_ID, "isHauled") &&
                  e.getFlag(MODULE_ID, "haulerId") === actor.id,
            )
            if (!eff) continue

            let offX = Number(eff.getFlag(MODULE_ID, "offsetX")) || 0
            let offY = Number(eff.getFlag(MODULE_ID, "offsetY")) || 0

            if (deltaRot !== 0) {
               const cos = Math.cos(deltaRot)
               const sin = Math.sin(deltaRot)
               const rx = offX * cos - offY * sin
               const ry = offX * sin + offY * cos
               offX = rx
               offY = ry
               await eff.update(
                  {
                     [`flags.${MODULE_ID}.offsetX`]: offX,
                     [`flags.${MODULE_ID}.offsetY`]: offY,
                  },
                  { haulCascade: true },
               )
            }

            const tw = (t.document.width ?? 1) * grid
            const th = (t.document.height ?? 1) * grid
            const update = {
               _id: t.document.id,
               x: Math.round(newCenter.x + offX - tw * 0.5),
               y: Math.round(newCenter.y + offY - th * 0.5),
            }
            if (movedRot) update.rotation = newRot
            updates.push(update)
         }
         if (updates.length > 0)
            await canvas.scene.updateEmbeddedDocuments("Token", updates, {
               haulSyncMovement: true,
            })
      })
   }

static _resolveActor(id) {
      if (!id) return null
      return (
         canvas?.tokens?.placeables?.find((t) => t.actor?.id === id)?.actor ||
         game.actors.get(id)
      )
   }

static async releaseTarget(haulerId, targetActorId, elevationData = null) {
      if (!game.user.isGM) {
         if (globalThis.siegeSocket)
            await globalThis.siegeSocket.executeAsGM(
               "haulRelease",
               haulerId,
               targetActorId,
               elevationData,
            )
         return
      }
      await this.enqueue(haulerId, async () => {
         const hauler = this._resolveActor(haulerId)
         const target = this._resolveActor(targetActorId)

         if (target) {
            const effs = target.itemTypes.effect.filter(
               (e) =>
                  e.getFlag(MODULE_ID, "isHauled") &&
                  e.getFlag(MODULE_ID, "haulerId") === haulerId,
            )

const elevationEntries =
               effs.length > 0
                  ? effs.map((e) => ({
                       applied: e.getFlag(MODULE_ID, "appliedElevation"),
                       prior: e.getFlag(MODULE_ID, "priorElevation") || 0,
                    }))
                  : elevationData
                    ? [
                         {
                            applied: elevationData.appliedElevation,
                            prior: elevationData.priorElevation || 0,
                         },
                      ]
                    : []

            for (const { applied, prior } of elevationEntries) {
               if (applied === null || applied === undefined) continue
               const token = target.getActiveTokens?.()[0]
               const tokenDoc = token?.document ?? token
               if (tokenDoc?.update && (tokenDoc.elevation || 0) === applied)
                  await tokenDoc.update(
                     { elevation: prior },
                     { haulSyncMovement: true },
                  )
               const fell = applied - prior
               if (fell > 0) await this._postFallMessage(target, hauler, fell)
            }

            if (effs.length > 0)
               await target.deleteEmbeddedDocuments(
                  "Item",
                  effs.map((e) => e.id),
                  { haulCascade: true },
               )
         }

         if (hauler) {
            const items = hauler.items.filter(
               (i) =>
                  i.getFlag(MODULE_ID, "isHauledItem") &&
                  i.getFlag(MODULE_ID, "hauledActorId") === targetActorId,
            )
            if (items.length > 0)
               await hauler.deleteEmbeddedDocuments(
                  "Item",
                  items.map((i) => i.id),
                  { haulCascade: true },
               )
            await this._refreshHaulingEffect(hauler)
         }
      })
   }

static async _onDeleteItem(item, options) {
      if (options.haulCascade) return

if (item.type === "effect" && item.getFlag(MODULE_ID, "isHauled")) {
         const haulerId = item.getFlag(MODULE_ID, "haulerId")
         const targetId = item.parent?.id
         const applied = item.getFlag(MODULE_ID, "appliedElevation")
         const prior = item.getFlag(MODULE_ID, "priorElevation") || 0
         await this.releaseTarget(haulerId, targetId, {
            appliedElevation: applied ?? null,
            priorElevation: prior,
            fromEffectDeletion: true,
         })
         return
      }

if (item.getFlag(MODULE_ID, "isHauledItem")) {
         const haulerId = item.getFlag(MODULE_ID, "haulerId")
         const targetId = item.getFlag(MODULE_ID, "hauledActorId")
         await this.releaseTarget(haulerId, targetId)
         return
      }

if (item.type === "effect" && item.getFlag(MODULE_ID, "isHauling")) {
         const hauler = item.parent
         if (!hauler) return
         
         const targetIds = [
            ...new Set(
               hauler.items
                  .filter((i) => i.getFlag(MODULE_ID, "isHauledItem"))
                  .map((i) => i.getFlag(MODULE_ID, "hauledActorId")),
            ),
         ]
         for (const id of targetIds) await this.releaseTarget(hauler.id, id)
      }
   }
}
