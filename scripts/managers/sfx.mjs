import { MODULE_ID } from "../constants.mjs"
import { slugify, renderHbs, tplPath, tKey } from "../utils.mjs"

export class SiegeSFXManager {
   static initHooks() {
      if (!this._visibilityHooked && globalThis.document?.addEventListener) {
         this._visibilityHooked = true
         globalThis.document.addEventListener("visibilitychange", () => {
            if (globalThis.document.hidden) this._pauseAllMovementSfxForHidden()
            else this._resumeAllMovementSfxAfterHidden()
         })
      }

      
      Hooks.on("preUpdateActor", (actor, changes) => {
         if (!game.user.isGM) return
         if (actor?.type !== "vehicle") return
         const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value")
         if (newHp === undefined) return
         actor._sfxPrevHp = actor.system?.attributes?.hp?.value ?? 0
      })
      Hooks.on("updateActor", (actor, changes) => {
         if (!game.user.isGM) return
         if (actor?.type !== "vehicle") return
         const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value")
         if (newHp === undefined) return
         const prev = actor._sfxPrevHp ?? newHp
         if (newHp <= 0 && prev > 0) this.play(actor, "destroyed")
         else if (newHp < prev) this.play(actor, "damaged")
         else if (newHp > prev) this.play(actor, "repair")
      })

      
      Hooks.on("preUpdateToken", (tokenDoc, changes) => {
         if (!game.user.isGM) return
         const actor = tokenDoc.actor
         if (actor?.type !== "vehicle") return
         
         if (changes.x !== undefined || changes.y !== undefined) {
            this._prePos = this._prePos || new Map()
            this._prePos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y })
         }
      })
      Hooks.on("updateToken", (tokenDoc, changes, options) => {
         if (!game.user.isGM) return
         const actor = tokenDoc.actor
         if (actor?.type !== "vehicle") return
         const movedX = changes.x !== undefined
         const movedY = changes.y !== undefined
         if (movedX || movedY) this._handleMovement(tokenDoc, actor, changes, options)
         
         if (changes.rotation !== undefined) this.play(actor, "rotate")
      })
   }

   
   
   
   
   static _handleMovement(tokenDoc, actor, changes = {}, options = {}) {
      if (globalThis.document?.hidden) return

      this._moveState = this._moveState || new Map()
      const id = tokenDoc.id

      
      
      const existing = this._moveState.get(id)
      if (existing) {
         existing.actor = actor
         existing.tokenDoc = tokenDoc
         existing.changes = changes
         this._scheduleMoveEnd(id, actor, tokenDoc, changes)
         return
      }

      
      const st = {
         actor,
         tokenDoc,
         changes,
         rawPath: null,
         paths: null,
         hiddenPaused: false,
         hiddenAt: 0,
         startTimer: null,
         continuousTimer: null,
         continuousStartTimer: null,
         resolveWarmupTimer: null,
         endTimer: null,
         endFailsafe: null,
         endGeneration: 0,
      }
      this._moveState.set(id, st)
      st.startTimer = setTimeout(() => {
         const current = this._moveState?.get(id)
         if (!current || globalThis.document?.hidden) return
         current.startTimer = null
         this.playIfConfigured(actor, "movement-start")
      }, this._movementInitialDelayMs(actor))
      this._startContinuousMovement(id, actor)
      this._scheduleMoveEnd(id, actor, tokenDoc, changes)
   }

   static _movementIntervalMs(actor) {
      const raw = Number(actor.getFlag(MODULE_ID, "movementSfxInterval"))
      if (!Number.isFinite(raw) || raw <= 0) return 1000
      return Math.max(250, Math.round(raw))
   }

   static _movementEndDelayMs(actor) {
      const interval = this._movementIntervalMs(actor)
      return Math.max(1000, interval * 2 + 100)
   }

   static _movementTravelDelayMs(id, actor, tokenDoc, changes = {}) {
      const fallback = this._movementIntervalMs(actor) + 50
      const animationDuration = Number(tokenDoc?.movement?.animation?.duration)
      if (Number.isFinite(animationDuration) && animationDuration > 0) {
         return Math.min(60000, Math.max(50, Math.ceil(animationDuration + 50)))
      }

      const prev = this._prePos?.get(id)
      if (!prev || !tokenDoc) return fallback

      const endX = changes.x ?? tokenDoc.x
      const endY = changes.y ?? tokenDoc.y
      const distancePx = Math.hypot(endX - prev.x, endY - prev.y)
      const gridSize = canvas?.grid?.size || 100
      const gridSpaces = gridSize > 0 ? distancePx / gridSize : 0
      if (!Number.isFinite(gridSpaces) || gridSpaces <= 0) return fallback

      const interval = this._movementIntervalMs(actor)
      const speed =
         Number(globalThis.CONFIG?.Token?.movement?.defaultSpeed) > 0
            ? Number(globalThis.CONFIG.Token.movement.defaultSpeed)
            : 6
      const estimated = Math.ceil((gridSpaces / speed) * 1000 + 50)
      return Math.min(30000, Math.max(interval + 50, estimated))
   }

   static _movementAnimationPromise(tokenDoc) {
      const promise =
         tokenDoc?.object?.movementAnimationPromise ||
         tokenDoc?.movement?.animation?.ended
      return promise && typeof promise.finally === "function" ? promise : null
   }

   static _rawPath(actor, key) {
      return actor?.getFlag?.(MODULE_ID, `sfx.${key}`) || ""
   }

   static _stopMovementSfx(id, playEnd = true, generation = null) {
      const st = this._moveState?.get(id)
      if (!st) return false
      if (generation !== null && st.endGeneration !== generation) return false
      if (st.startTimer) clearTimeout(st.startTimer)
      if (st.continuousStartTimer) clearTimeout(st.continuousStartTimer)
      if (st.resolveWarmupTimer) clearTimeout(st.resolveWarmupTimer)
      if (st.continuousTimer) clearInterval(st.continuousTimer)
      if (st.endTimer) clearTimeout(st.endTimer)
      if (st.endFailsafe) clearTimeout(st.endFailsafe)
      if (playEnd && st.actor) this.playIfConfigured(st.actor, "movement-end")
      this._moveState.delete(id)
      this._prePos?.delete(id)
      return true
   }

   static _stopAllMovementSfx(playEnd = false) {
      const ids = Array.from(this._moveState?.keys?.() || [])
      for (const id of ids) this._stopMovementSfx(id, playEnd)
   }

   static _pauseAllMovementSfxForHidden() {
      for (const st of this._moveState?.values?.() || []) {
         st.hiddenPaused = true
         st.hiddenAt = Date.now()
         if (st.startTimer) clearTimeout(st.startTimer)
         if (st.continuousStartTimer) clearTimeout(st.continuousStartTimer)
         if (st.resolveWarmupTimer) clearTimeout(st.resolveWarmupTimer)
         if (st.continuousTimer) clearInterval(st.continuousTimer)
         if (st.endTimer) clearTimeout(st.endTimer)
         if (st.endFailsafe) clearTimeout(st.endFailsafe)
         st.startTimer = null
         st.continuousStartTimer = null
         st.resolveWarmupTimer = null
         st.continuousTimer = null
         st.endTimer = null
         st.endFailsafe = null
      }
   }

   static _resumeAllMovementSfxAfterHidden() {
      const resume = (attempt = 0) => {
         for (const [id, st] of this._moveState?.entries?.() || []) {
            if (!st.hiddenPaused) continue
            const hiddenMs = Date.now() - (st.hiddenAt || Date.now())
            const maxHiddenMs = Math.max(5000, this._movementEndDelayMs(st.actor) * 3)
            if (hiddenMs > maxHiddenMs) {
               this._stopMovementSfx(id, false)
               continue
            }
            st.hiddenPaused = false
            this._startContinuousMovement(id, st.actor)
            this._scheduleMoveEnd(id, st.actor, st.tokenDoc, st.changes || {})
         }
         if (
            attempt < 5 &&
            Array.from(this._moveState?.values?.() || []).some(
               (st) => st.hiddenPaused,
            )
         )
            setTimeout(() => resume(attempt + 1), 100)
      }
      setTimeout(() => resume(0), 100)
   }

   static _hasActiveMovementAnimation(tokenDoc) {
      if (tokenDoc?.object?.movementAnimationPromise) return true
      const state = tokenDoc?.movement?.state
      return state === "pending" || state === "paused"
   }

   static _movementInitialDelayMs(actor) {
      const interval = this._movementIntervalMs(actor)
      return Math.max(150, Math.min(250, Math.round(interval / 2)))
   }

   static _movementContinuousInitialDelayMs(actor) {
      const interval = this._movementIntervalMs(actor)
      return Math.max(200, Math.min(300, Math.round(interval / 2)))
   }

   static async _startContinuousMovement(id, actor) {
      const rawPath = this._rawPath(actor, "movement-continuous")
      if (!rawPath) return

      const st = this._moveState?.get(id)
      if (!st) return
      st.rawPath = rawPath
      st.paths =
         this._getPathChoicesCache(rawPath) ||
         (!rawPath.includes("*") ? [rawPath] : st.paths)
      if (st.resolveWarmupTimer) clearTimeout(st.resolveWarmupTimer)
      st.resolveWarmupTimer = null
      if (rawPath.includes("*") && !st.paths?.length) {
         st.resolveWarmupTimer = setTimeout(() => {
            const current = this._moveState?.get(id)
            if (!current || current.hiddenPaused || globalThis.document?.hidden)
               return
            current.resolveWarmupTimer = null
            this._ensureContinuousPaths(id).catch((err) =>
               console.warn("[siege][sfx] movement wildcard warmup failed", err),
            )
         }, 50)
      }
      if (st.continuousStartTimer) clearTimeout(st.continuousStartTimer)
      st.continuousStartTimer = setTimeout(() => {
         this._beginContinuousMovement(id)
      }, this._movementContinuousInitialDelayMs(actor))
   }

   static async _beginContinuousMovement(id) {
      const st = this._moveState?.get(id)
      if (!st || !st.rawPath) return
      st.continuousStartTimer = null
      if (st.resolveWarmupTimer) {
         clearTimeout(st.resolveWarmupTimer)
         st.resolveWarmupTimer = null
      }
      if (globalThis.document?.hidden) {
         st.hiddenPaused = true
         return
      }
      const paths = await this._ensureContinuousPaths(id)
      const current = this._moveState?.get(id)
      if (!current || !paths?.length) return
      if (globalThis.document?.hidden) {
         current.hiddenPaused = true
         return
      }
      if (current.continuousTimer) clearInterval(current.continuousTimer)
      this._playContinuousMovement(id)
      current.continuousTimer = setInterval(
         () => this._playContinuousMovement(id),
         this._movementIntervalMs(current.actor),
      )
   }

   static async _ensureContinuousPaths(id) {
      const st = this._moveState?.get(id)
      if (!st?.rawPath) return null
      if (st.paths?.length) return st.paths
      st.resolvingPaths ||= this.resolvePathChoices(st.rawPath)
      const paths = await st.resolvingPaths
      const current = this._moveState?.get(id)
      if (!current) return null
      current.paths = paths
      current.resolvingPaths = null
      return paths
   }

   static _playContinuousMovement(id) {
      const st = this._moveState?.get(id)
      if (!st?.paths?.length) return
      if (globalThis.document?.hidden) {
         st.hiddenPaused = true
         if (st.continuousTimer) clearInterval(st.continuousTimer)
         st.continuousTimer = null
         return
      }
      const path =
         st.paths[Math.floor(Math.random() * st.paths.length)] || st.rawPath
      console.debug(`[siege][sfx] play "movement-continuous" -> ${path}`)
      this._broadcast(path, this._isGlobal(st.actor, "movement-continuous"))
   }

   
   
   
   static _scheduleMoveEnd(id, actor, tokenDoc = null, changes = {}) {
      const st = this._moveState?.get(id)
      if (!st) return
      if (st.endTimer) clearTimeout(st.endTimer)
      if (st.endFailsafe) clearTimeout(st.endFailsafe)
      const generation = ++st.endGeneration
      const stop = () => {
         this._stopMovementSfx(id, true, generation)
      }
      const attachToAnimation = (promise) => {
         promise.finally(() => {
            const current = this._moveState?.get(id)
            if (!current || current.endGeneration !== generation) return
            stop()
         })
         st.endFailsafe = setTimeout(stop, 60000)
      }

      const promise = this._movementAnimationPromise(tokenDoc)
      if (promise) {
         attachToAnimation(promise)
         return
      }

      const fallbackDelay = this._movementTravelDelayMs(id, actor, tokenDoc, changes)
      st.endTimer = setTimeout(() => {
         const current = this._moveState?.get(id)
         if (!current || current.endGeneration !== generation) return
         const laterPromise = this._movementAnimationPromise(tokenDoc)
         if (laterPromise) attachToAnimation(laterPromise)
         else current.endTimer = setTimeout(stop, fallbackDelay)
      }, 0)
   }

   static async resolvePath(path) {
      const choices = await this.resolvePathChoices(path)
      return choices[Math.floor(Math.random() * choices.length)] || path
   }

   static async resolvePathChoices(path) {
      if (!path?.includes("*")) return [path]

      const cached = this._getPathChoicesCache(path)
      if (cached) return cached

      if (!game.user.isGM && globalThis.siegeSocket) {
         try {
            const choices = await globalThis.siegeSocket.executeAsGM(
               "resolvePathChoices",
               path,
            )
            if (Array.isArray(choices) && choices.length > 0) {
               this._setPathChoicesCache(path, choices)
               return choices
            }
            const choice = await globalThis.siegeSocket.executeAsGM(
               "resolvePath",
               path,
            )
            this._setPathChoicesCache(path, [choice])
            return [choice]
         } catch {
            return [path]
         }
      }

      const parts = path.split("/")
      const fileName = parts.pop()
      const dir = parts.join("/")
      const pattern = new RegExp(
         `^${fileName
            .split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*")}$`,
      )

      try {
         const resp =
            await foundry.applications.apps.FilePicker.implementation.browse(
               "data",
               dir,
            )
         const matches = resp.files.filter((f) =>
            pattern.test(f.split("/").pop()),
         )
         if (matches.length === 0) return [path]
         this._setPathChoicesCache(path, matches)
         return matches
      } catch {
         return [path]
      }
   }

   static _getPathChoicesCache(path) {
      const entry = this._pathChoicesCache?.get(path)
      if (!entry) return null
      if (Date.now() - entry.time > 300000) {
         this._pathChoicesCache.delete(path)
         return null
      }
      return entry.choices
   }

   static _setPathChoicesCache(path, choices) {
      this._pathChoicesCache = this._pathChoicesCache || new Map()
      this._pathChoicesCache.set(path, { choices, time: Date.now() })
   }

   static _preloadPaths(paths, limit = 4) {
      const audioHelper = globalThis.foundry?.audio?.AudioHelper
      if (!audioHelper?.preloadSound) return
      this._preloadedPaths = this._preloadedPaths || new Set()
      for (const path of paths.slice(0, limit)) {
         if (!path || path.includes("*") || this._preloadedPaths.has(path)) continue
         this._preloadedPaths.add(path)
         setTimeout(() => {
            audioHelper.preloadSound(path).catch(() => {
               this._preloadedPaths.delete(path)
            })
         }, 0)
      }
   }

   static async play(actor, key, sourceUserId = null) {
      if (!game.user.isGM && globalThis.siegeSocket) {
         const actorUuid = actor?.uuid || actor?.id
         if (actorUuid)
            return globalThis.siegeSocket.executeAsGM(
               "playActorSFX",
               actorUuid,
               key,
               sourceUserId || game.user.id,
            )
      }
      return this._playLocal(actor, key, sourceUserId)
   }

   static async _playLocal(actor, key, sourceUserId = null) {
      const rawPath = actor.getFlag(MODULE_ID, `sfx.${key}`)
      if (!rawPath) {
         console.debug(`[siege][sfx] no path set for key="${key}" on ${actor?.name}`)
         return
      }

      
      
      if (key === "enter" || key === "exit") {
         this._enterExitBusy = this._enterExitBusy || new Set()
         if (this._enterExitBusy.has(actor.id)) {
            console.debug(
               `[siege][sfx] enter/exit busy for ${actor.name}; dropping "${key}"`,
            )
            return
         }
         this._enterExitBusy.add(actor.id)
         const path = await this.resolvePath(rawPath)
         console.debug(`[siege][sfx] play enter/exit "${key}" -> ${path}`)
         try {
            await this._playAndWait(path, this._isGlobal(actor, key), sourceUserId)
         } finally {
            this._enterExitBusy.delete(actor.id)
         }
         return
      }

      
      
      if (key === "rotate") {
         this._rotateBusy = this._rotateBusy || new Set()
         if (this._rotateBusy.has(actor.id)) {
            console.debug(`[siege][sfx] rotate busy for ${actor.name}; dropping`)
            return
         }
         this._rotateBusy.add(actor.id)
         const path = await this.resolvePath(rawPath)
         console.debug(`[siege][sfx] play rotate -> ${path}`)
         try {
            await this._playAndWait(path, this._isGlobal(actor, key), sourceUserId)
            const delayMs =
               (Number(actor.getFlag(MODULE_ID, "rotateSfxDelay")) || 0) * 1000
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
         } finally {
            this._rotateBusy.delete(actor.id)
         }
         return
      }

      const path = await this.resolvePath(rawPath)
      console.debug(`[siege][sfx] play "${key}" -> ${path}`)
      this._broadcast(path, this._isGlobal(actor, key), sourceUserId)
   }

   static playIfConfigured(actor, key) {
      if (!this._rawPath(actor, key)) return
      this.play(actor, key)
   }

   static _isGlobal(actor, key) {
      const value = actor?.getFlag?.(MODULE_ID, `sfxGlobal.${key}`)
      return value !== false
   }

   
   
   static async _playAndWait(path, playGlobally = true, sourceUserId = null) {
      this._broadcast(path, playGlobally, sourceUserId)
      await new Promise((r) => setTimeout(r, 1200))
   }

   static _broadcast(path, playGlobally = true, sourceUserId = null) {
      if (globalThis.document?.hidden) return
      if (
         playGlobally &&
         game.modules.get("socketlib")?.active &&
         globalThis.siegeSocket
      ) {
         globalThis.siegeSocket.executeForEveryone("playSFX", { path, volume: 0.8 })
      } else if (
         sourceUserId &&
         sourceUserId !== game.user?.id &&
         game.modules.get("socketlib")?.active &&
         globalThis.siegeSocket
      ) {
         globalThis.siegeSocket.executeAsUser("playSFX", sourceUserId, {
            path,
            volume: 0.8,
         })
      } else {
         foundry.audio.AudioHelper.play({ src: path, volume: 0.8 }, playGlobally)
      }
   }

   static async buildTabUI(app, html) {
      const tab = html.find(".tab.sfx")
      const siege = app.document
      const sfx = siege.getFlag(MODULE_ID, "sfx") || {}
      const ammoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || []
      const loadName = tKey("ActionTemplates.Load.Name")
      const allActions = siege.items.filter(
         (i) =>
            i.type === "action" && i.name !== loadName && i.name !== "Loading",
      )
      const enterable = !!siege.getFlag(MODULE_ID, "enterable")

      const row = (key, label, extra = {}) => ({
         key,
         label,
         value: sfx[key] || "",
         global: this._isGlobal(siege, key),
         globalLabel: tKey("SFX.PlayGlobally"),
         ...extra,
      })

      
      
      const otherActions = []
      for (const a of allActions) {
         const flag = a.getFlag(MODULE_ID, "siegeAction") || {}
         if (!(flag.isStrike || flag.isAttack)) otherActions.push(a)
      }

      
      const baseRows = []
      if (enterable) {
         baseRows.push(row("enter", tKey("SFX.Enter")))
         baseRows.push(row("exit", tKey("SFX.Exit")))
         baseRows.push(row("launch", tKey("SFX.StartIgnition")))
         baseRows.push(row("stopIgnition", tKey("SFX.StopIgnition")))
      }
      baseRows.push(row("openStash", tKey("SFX.OpenStash")))
      baseRows.push(row("damaged", tKey("SFX.Damaged")))
      baseRows.push(row("destroyed", tKey("SFX.Destroyed")))
      baseRows.push(row("repair", tKey("SFX.Repair")))
      const rotateDelay = siege.getFlag(MODULE_ID, "rotateSfxDelay") ?? 0

      
      const loadRows = ammoTypes.map((t) =>
         row(`load-${slugify(t.slug || t.name)}`, t.name),
      )

      
      const actionRows = otherActions.map((a) => row(`action-${a.id}`, a.name))

      
      const movementRows = [
         row("movement-continuous", tKey("SFX.MovementContinuous")),
         row("movement-start", tKey("SFX.MovementStart")),
         row("movement-end", tKey("SFX.MovementEnd")),
      ]
      if (enterable) movementRows.push(row("rotate", tKey("SFX.Rotate")))
      const movementInterval =
         this._movementIntervalMs(siege)

      const sections = [
         {
            id: "base",
            title: tKey("SFX.SectionBase"),
            rows: baseRows,
         },
         { id: "loading", title: tKey("SFX.SectionLoading"), rows: loadRows },
         { id: "actions", title: tKey("SFX.SectionActions"), rows: actionRows },
         {
            id: "movement",
            title: tKey("SFX.SectionMovement"),
            rows: movementRows,
            intervals: [
               {
                  label: tKey("SFX.MovementInterval"),
                  value: movementInterval,
                  className: "sfx-move-interval",
                  min: 250,
               },
               {
                  label: tKey("SFX.RotateDelay"),
                  value: rotateDelay,
                  className: "sfx-rotate-delay",
                  min: 0,
               },
            ],
         },
      ].filter((s) => s.rows.length > 0 || s.id === "movement")

      const htmlContent = await renderHbs(tplPath("sheet/sfx-tab.hbs"), {
         sections,
         globalHeader: tKey("SFX.Header"),
      })
      tab.html(htmlContent)

      app._siegeSfxOpenSections = app._siegeSfxOpenSections || new Set()
      const setAccOpen = (acc, open) => {
         acc.toggleClass("open", open)
         acc.find(".sfx-acc-body").toggle(open)
         const caret = acc.find(".sfx-acc-caret")
         caret.toggleClass("fa-chevron-down", open)
         caret.toggleClass("fa-chevron-right", !open)
      }
      for (const id of app._siegeSfxOpenSections) {
         const acc = tab.find(`.sfx-acc[data-section="${id}"]`)
         if (acc.length) setAccOpen(acc, true)
      }

      const updateNoRender = (path, value) =>
         siege.update({ [`flags.${MODULE_ID}.${path}`]: value }, { render: false })

      
      tab.find(".sfx-acc-head").on("click", (e) => {
         const acc = $(e.currentTarget).closest(".sfx-acc")
         const open = !acc.hasClass("open")
         const id = acc.data("section")
         if (open) app._siegeSfxOpenSections.add(id)
         else app._siegeSfxOpenSections.delete(id)
         setAccOpen(acc, open)
      })

      tab.find(".sfx-input").on("change", async (e) => {
         const key = $(e.currentTarget).data("key")
         await updateNoRender(`sfx.${key}`, $(e.currentTarget).val())
      })

      tab.find(".sfx-global-cb").on("change", async (e) => {
         const key = $(e.currentTarget).data("key")
         await updateNoRender(`sfxGlobal.${key}`, e.currentTarget.checked)
      })

      tab.find(".play-sfx").on("click", (e) => {
         this.play(siege, $(e.currentTarget).data("key"))
      })

      tab.find(".file-picker").on("click", (e) => {
         new foundry.applications.apps.FilePicker.implementation({
            type: "audio",
            callback: async (path) => {
               const key = $(e.currentTarget).data("target")
               await updateNoRender(`sfx.${key}`, path)
               html.find(`.sfx-input[data-key="${key}"]`).val(path)
            },
         }).browse()
      })

      
      tab.find(".sfx-move-interval").on("change", async (e) => {
         const n = Math.max(250, parseInt($(e.currentTarget).val()) || 1000)
         await updateNoRender("movementSfxInterval", n)
      })

      
      tab.find(".sfx-rotate-delay").on("change", async (e) => {
         const n = Math.max(0, parseFloat($(e.currentTarget).val()) || 0)
         await updateNoRender("rotateSfxDelay", n)
      })
   }
}
