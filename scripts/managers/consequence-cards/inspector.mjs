import { MODULE_ID } from "../../constants.mjs"
import { tKey } from "../../utils.mjs"
import { CARD_FLAG, staticMethods } from "./helpers.mjs"

class ConsequenceCardInspectorMixin {
   static async _persistCardContent(
      card,
      {
         inspectorKey = null,
         inspectorSource = null,
         inspectorClear = false,
         cardData = null,
      } = {},
   ) {
      const messageId = card?.closest(".message")?.dataset.messageId
      const message = messageId ? game.messages.get(messageId) : null
      if (!message || !card) return false
      const payload = {
         messageId,
         content: card.outerHTML,
         inspectorKey,
         inspectorSource,
         inspectorClear,
         cardData,
      }
      if (game.user.isGM) {
         await this.gmPersistCard(payload).catch(() => {})
         return true
      }
      if (globalThis.siegeSocket) {
         await globalThis.siegeSocket
            .executeAsGM("persistConsequenceCard", payload)
            .catch(() => {})
         return true
      }
      await message.update({ content: card.outerHTML }).catch(() => {})
      return true
   }

   static _captureInspectorSource(message) {
      try {
         if (!message) return null
         const source = message.toObject?.() ?? {}
         const pf2e = message.flags?.pf2e ?? source.flags?.pf2e
         if (!pf2e?.context) return null
         return {
            type: source.type ?? message.type ?? "base",
            author: game.user?.id ?? null,
            speaker: source.speaker ?? message.speaker ?? {},
            flags: { pf2e: foundry.utils.deepClone(pf2e) },
         }
      } catch (_err) {
         return null
      }
   }

   static _liElement(li) {
      if (!li) return null
      if (li instanceof HTMLElement) return li
      if (li[0] instanceof HTMLElement) return li[0]
      if (li.element instanceof HTMLElement) return li.element
      return null
   }

   static _liMessageId(li) {
      const element = this._liElement(li)
      return (
         element?.dataset?.messageId ||
         element?.closest?.("[data-message-id]")?.dataset?.messageId ||
         null
      )
   }

   static _inspectorContextForLi(li) {
      if (!this._inspectorContext) return null
      const id = this._liMessageId(li)
      if (id && id !== this._inspectorContext.messageId) return null
      return this._inspectorContext
   }

   static _rerollContextForLi(li) {
      if (!this._rerollContext) return null
      const id = this._liMessageId(li)
      if (id && id !== this._rerollContext.messageId) return null
      return this._rerollContext
   }

   static _cardElementFor(messageId) {
      if (!messageId || typeof document === "undefined") return null
      const escape = globalThis.CSS?.escape || ((value) => String(value))
      return document.querySelector(
         `[data-message-id="${escape(messageId)}"] .siege-consequence-card`,
      )
   }

   static _rerollRowForContext(ctx) {
      const card = this._cardElementFor(ctx?.messageId)
      if (!card || !ctx?.targetUuid) return null
      const escape = globalThis.CSS?.escape || ((value) => String(value))
      return card.querySelector(
         `.target-row[data-target-uuid="${escape(ctx.targetUuid)}"]`,
      )
   }

   static _canHeroPointReroll(li) {
      const ctx = this._rerollContextForLi(li)
      if (!ctx?.targetUuid) return false
      const message = game.messages?.get?.(ctx.messageId)
      if (!message?.getFlag?.(MODULE_ID, CARD_FLAG)) return false
      const row = this._rerollRowForContext(ctx)
      if (!row || row.dataset.rolled !== "true") return false
      if (!row.querySelector("[data-siege-consequence-action='save']"))
         return false
      if (!this._ownsTargetSync(ctx.targetUuid)) return false
      return this._canHeroPointRerollSync(ctx.targetUuid)
   }

   static async _heroPointReroll(li) {
      const ctx = this._rerollContextForLi(li) || this._rerollContext
      if (!ctx?.targetUuid) return false
      const card = this._cardElementFor(ctx.messageId)
      const row = this._rerollRowForContext(ctx)
      const control = row?.querySelector("[data-siege-consequence-action='save']")
      if (!card || !row || !control) return false
      if (!(await this._canUseTarget(ctx.targetUuid))) {
         ui.notifications.warn(tKey("Consequences.CardOwnerOnly"))
         return false
      }
      return this._rollSavingThrow(control, card, ctx.targetUuid, {
         isReroll: true,
         heroPoint: true,
      })
   }

   static _ownsTargetSync(targetUuid) {
      if (game.user?.isGM) return true
      const token = globalThis.fromUuidSync?.(targetUuid)
      const actor = token?.actor
      return !!actor?.testUserPermission?.(game.user, "OWNER")
   }

   static _canHeroPointRerollSync(targetUuid) {
      const token = globalThis.fromUuidSync?.(targetUuid)
      const actor = this._heroPointActor(token?.actor)
      if (!actor?.isOfType?.("character")) return false
      const path = this._heroPointPath(actor)
      const value = Number(path ? foundry.utils.getProperty(actor, path) : NaN)
      return Number.isFinite(value) && value > 0
   }

   static _storedInspectorKey(message, ctx) {
      const store = message?.getFlag?.(MODULE_ID, "inspector") || {}
      if (ctx?.key && store[ctx.key]) return ctx.key
      const keys = Object.keys(store).filter((key) => store[key])
      return keys.length === 1 ? keys[0] : null
   }

   static _hasStoredInspector(li) {
      if (!game.user?.isGM) return false
      const ctx = this._inspectorContextForLi(li)
      if (!ctx) return false
      const message = game.messages?.get?.(ctx.messageId)
      if (!message?.getFlag?.(MODULE_ID, CARD_FLAG)) return false
      return !!this._storedInspectorKey(message, ctx)
   }

   static async _openStoredInspector(li) {
      const ctx = this._inspectorContextForLi(li) || this._inspectorContext
      const message = ctx ? game.messages?.get?.(ctx.messageId) : null
      const key = this._storedInspectorKey(message, ctx)
      if (!message || !key) return false
      const store = message.getFlag(MODULE_ID, "inspector") || {}
      let source = store[key]
      try {
         source = typeof source === "string" ? JSON.parse(source) : source
      } catch (_err) {
         return false
      }
      try {
         const Msg = ChatMessage.implementation ?? ChatMessage
         delete source._id
         const temp = new Msg(source)
         if (typeof temp.showDetails === "function") {
            await temp.showDetails()
            return true
         }
      } catch (_err) {}
      return false
   }

   static _tokenDocsForTargets(targets) {
      const seen = new Set()
      const docs = []
      for (const actor of targets) {
         const active = actor?.getActiveTokens?.() || []
         const token =
            active.find((candidate) => candidate?.document?.uuid)?.document ||
            active.find((candidate) => candidate?.uuid) ||
            null
         if (!token?.uuid || seen.has(token.uuid)) continue
         seen.add(token.uuid)
         docs.push(token)
      }
      return docs
   }

   static _targetTokenDocs(tokenDocs) {
      try {
         const ids = tokenDocs.map((doc) => doc.id).filter(Boolean)
         if (ids.length > 0) game.user.updateTokenTargets(ids)
      } catch (_err) {}
   }

   static _escape(value) {
      return foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")
   }
}

export const consequenceCardInspectorMethods = staticMethods(ConsequenceCardInspectorMixin)
