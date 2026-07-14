import { MODULE_ID } from "../constants.mjs"
import { slugify, renderHbs, tplPath, tKey } from "../utils.mjs"

export class SiegeSFXManager {
   static initHooks() {
      this._registerGameSocketAudio()
      Hooks.once("ready", () => {
         this._registerGameSocketAudio()
         if (game.user.isGM) this._warmKnownMovementSfx()
      })

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
      Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
         if (!game.user.isGM) return
         const actor = tokenDoc.actor
         if (actor?.type !== "vehicle") return
         const movedX = changes.x !== undefined
         const movedY = changes.y !== undefined
         const sourceUserId = options?.siegeSourceUserId || userId || null
         if (movedX || movedY)
            this._handleMovement(tokenDoc, actor, changes, {
               ...options,
               sourceUserId,
            })

         if (changes.rotation !== undefined) this.play(actor, "rotate", sourceUserId)
      })
   }

static _handleMovement(tokenDoc, actor, changes = {}, options = {}) {
      this._moveState = this._moveState || new Map()
      const id = tokenDoc.id

const existing = this._moveState.get(id)
      if (existing) {
         existing.actor = actor
         existing.tokenDoc = tokenDoc
         existing.changes = changes
         existing.sourceUserId = options.sourceUserId || existing.sourceUserId || null
         if (!existing.continuousTimer && !existing.continuousStartTimer)
            this._startContinuousMovement(id, actor)
         this._scheduleMoveEnd(id, actor, tokenDoc, changes)
         return
      }

const st = {
         actor,
         tokenDoc,
         changes,
         rawPath: null,
         paths: null,
         sourceUserId: options.sourceUserId || null,
         startTimer: null,
         continuousTimer: null,
         continuousStartTimer: null,
         resolveWarmupTimer: null,
         endTimer: null,
         endFailsafe: null,
         endGeneration: 0,
         playedContinuous: false,
      }
      this._moveState.set(id, st)
      st.startTimer = setTimeout(() => {
         const current = this._moveState?.get(id)
         if (!current) return
         current.startTimer = null
         this._playMovementKey(current, "movement-start")
      }, this._movementInitialDelayMs(actor))
      this._startContinuousMovement(id, actor)
      this._scheduleMoveEnd(id, actor, tokenDoc, changes)
   }

   static _movementIntervalMs(actor) {
      const raw = Number(this._flag(actor, "movementSfxInterval"))
      if (!Number.isFinite(raw) || raw <= 0) return 1000
      return Math.max(250, Math.round(raw))
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
      return Math.min(30000, Math.max(150, estimated))
   }

   static _movementAnimationPromise(tokenDoc) {
      const promise =
         tokenDoc?.object?.movementAnimationPromise ||
         tokenDoc?.movement?.animation?.ended
      return promise && typeof promise.finally === "function" ? promise : null
   }

   static _rawPath(actor, key) {
      return this._flag(actor, `sfx.${key}`, { fallbackOnEmpty: true }) || ""
   }

   static _baseActor(actor) {
      if (!actor) return null
      const base =
         actor.token?.baseActor ||
         (actor.isToken && actor.id ? game.actors.get(actor.id) : null)
      return base && base !== actor ? base : null
   }

   static _flag(actor, key, { fallbackOnEmpty = false } = {}) {
      const value = actor?.getFlag?.(MODULE_ID, key)
      const missing =
         value === undefined ||
         value === null ||
         (fallbackOnEmpty && value === "")
      if (!missing) return value
      return this._baseActor(actor)?.getFlag?.(MODULE_ID, key)
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
      if (playEnd && st.actor) this._playMovementKey(st, "movement-end", true)
      this._moveState.delete(id)
      this._prePos?.delete(id)
      return true
   }

   static _stopAllMovementSfx(playEnd = false) {
      const ids = Array.from(this._moveState?.keys?.() || [])
      for (const id of ids) this._stopMovementSfx(id, playEnd)
   }

   static _hasActiveMovementAnimation(tokenDoc) {
      if (tokenDoc?.object?.movementAnimationPromise) return true
      const state = tokenDoc?.movement?.state
      return state === "pending" || state === "paused"
   }

   static _movementInitialDelayMs(actor) {
      return 0
   }

   static _movementContinuousInitialDelayMs(actor) {
      return 0
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
            if (!current) return
            current.resolveWarmupTimer = null
            this._ensureContinuousPaths(id).catch(() => {})
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
      const paths = await this._ensureContinuousPaths(id, st)
      const current = this._moveState?.get(id)
      if (!paths?.length) return
      if (!current) {
         if (!st.playedContinuous) {
            st.paths = paths
            this._playContinuousMovementFromState(st)
         }
         return
      }
      if (current.continuousTimer) clearInterval(current.continuousTimer)
      this._playContinuousMovement(id)
      current.continuousTimer = setInterval(
         () => this._playContinuousMovement(id),
         this._movementIntervalMs(current.actor),
      )
   }

   static async _ensureContinuousPaths(id, fallbackState = null) {
      const st = this._moveState?.get(id) || fallbackState
      if (!st?.rawPath) return null
      if (st.paths?.length) return st.paths
      st.resolvingPaths ||= this.resolvePathChoices(st.rawPath)
      const paths = await st.resolvingPaths
      const current = this._moveState?.get(id)
      if (current) {
         current.paths = paths
         current.resolvingPaths = null
      } else if (fallbackState) {
         fallbackState.paths = paths
         fallbackState.resolvingPaths = null
      } else {
         return null
      }
      return paths
   }

   static _playContinuousMovement(id) {
      const st = this._moveState?.get(id)
      if (!st?.paths?.length) return
      this._playContinuousMovementFromState(st)
   }

   static _playContinuousMovementFromState(st) {
      if (!st?.paths?.length) return
      const path =
         st.paths[Math.floor(Math.random() * st.paths.length)] || st.rawPath
      this._playMovementPath(st, path, "movement-continuous")
      st.playedContinuous = true
   }

   static async _playMovementKey(st, key, allowStopped = false) {
      if (!st?.actor) return false
      const rawPath = this._rawPath(st.actor, key)
      if (!rawPath) return false
      const path = await this.resolvePath(rawPath)
      const current = [...(this._moveState?.values?.() || [])].includes(st)
      if (!current && !allowStopped) return false
      this._playMovementPath(st, path, key)
      return true
   }

   static _playMovementPath(st, path, key) {
      if (!path || !st?.actor) return false
      this._broadcast(path, this._isGlobal(st.actor, key), st.sourceUserId)
      return true
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
      }
      const fallbackDelay = Math.max(
         this._movementTravelDelayMs(id, actor, tokenDoc, changes),
         150,
      )
      st.endTimer = setTimeout(stop, fallbackDelay)

      const promise = this._movementAnimationPromise(tokenDoc)
      if (promise) {
         attachToAnimation(promise)
         return
      }

      st.endFailsafe = setTimeout(() => {
         const current = this._moveState?.get(id)
         if (!current || current.endGeneration !== generation) return
         const laterPromise = this._movementAnimationPromise(tokenDoc)
         if (laterPromise) attachToAnimation(laterPromise)
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
      this._pathChoicesPending = this._pathChoicesPending || new Map()
      const pending = this._pathChoicesPending.get(path)
      if (pending) return pending

      const promise = this._resolvePathChoicesUncached(path)
      this._pathChoicesPending.set(path, promise)
      try {
         return await promise
      } finally {
         this._pathChoicesPending.delete(path)
      }
   }

   static async _resolvePathChoicesUncached(path) {
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

   static warmMovementSFX(actor) {
      if (!actor) return
      for (const key of [
         "movement-continuous",
         "movement-start",
         "movement-end",
         "rotate",
      ]) {
         const rawPath = this._rawPath(actor, key)
         if (!rawPath) continue
         this.resolvePathChoices(rawPath)
            .then((paths) => this._preloadPaths(paths))
            .catch(() => {})
      }
   }

   static _warmKnownMovementSfx() {
      const actors = new Set()
      for (const actor of game.actors ?? []) {
         if (actor?.type === "vehicle") actors.add(actor)
      }
      for (const token of canvas?.tokens?.placeables ?? []) {
         if (token.actor?.type === "vehicle") actors.add(token.actor)
      }
      for (const actor of actors) this.warmMovementSFX(actor)
   }

   static async play(actor, key, sourceUserId = null) {
      if (!actor) return false
      if (!game.user.isGM) {
         if (this._rawPath(actor, key))
            return this._playLocal(actor, key, sourceUserId || game.user.id)
         const actorUuid = actor?.uuid || actor?.id
         if (actorUuid && globalThis.siegeSocket) {
            try {
               return await globalThis.siegeSocket.executeAsGM(
                  "playActorSFX",
                  actorUuid,
                  key,
                  sourceUserId || game.user.id,
               )
            } catch {

            }
         }
      }
      return this._playLocal(actor, key, sourceUserId)
   }

   static async _playLocal(actor, key, sourceUserId = null) {
      const rawPath = this._rawPath(actor, key)
      if (!rawPath) {
         return false
      }

if (key === "enter" || key === "exit") {
         this._enterExitBusy = this._enterExitBusy || new Set()
         if (this._enterExitBusy.has(actor.id)) {
            return
         }
         this._enterExitBusy.add(actor.id)
         const path = await this.resolvePath(rawPath)
         try {
            await this._playAndWait(path, this._isGlobal(actor, key), sourceUserId)
         } finally {
            this._enterExitBusy.delete(actor.id)
         }
         return true
      }

if (key === "rotate") {
         this._rotateBusy = this._rotateBusy || new Set()
         if (this._rotateBusy.has(actor.id)) {
            return
         }
         this._rotateBusy.add(actor.id)
         const path = await this.resolvePath(rawPath)
         try {
            this._broadcast(path, this._isGlobal(actor, key), sourceUserId)
         } finally {
            const delayMs = Math.max(
               0,
               Math.round(Number(this._flag(actor, "rotateSfxDelay")) || 0),
            )
            if (delayMs > 0) {
               setTimeout(() => this._rotateBusy?.delete(actor.id), delayMs)
            } else {
               this._rotateBusy.delete(actor.id)
            }
         }
         return true
      }

      const path = await this.resolvePath(rawPath)
      this._broadcast(path, this._isGlobal(actor, key), sourceUserId)
      return true
   }

   static playIfConfigured(actor, key, sourceUserId = null) {
      if (!actor) return false
      if (game.user.isGM || !globalThis.siegeSocket) {
         if (!this._rawPath(actor, key)) return false
      }
      return this.play(actor, key, sourceUserId)
   }

   static _isGlobal(actor, key) {
      const value = this._flag(actor, `sfxGlobal.${key}`)
      return value !== false
   }

static async _playAndWait(path, playGlobally = true, sourceUserId = null) {
      this._broadcast(path, playGlobally, sourceUserId)
      await new Promise((r) => setTimeout(r, 1200))
   }

   static _activeAudioUserIds() {
      const users =
         game.users?.filter?.((u) => u.active) ||
         game.users?.contents?.filter?.((u) => u.active) ||
         Array.from(game.users || [])
            .map((u) => (Array.isArray(u) ? u[1] : u))
            .filter((u) => u?.active)
      return users.map((u) => u.id).filter(Boolean)
   }

   static _registerGameSocketAudio() {
      if (this._gameSocketAudioRegistered) return
      if (!game.socket?.on) return
      this._gameSocketAudioRegistered = true
      game.socket.on(`module.${MODULE_ID}`, (payload) => {
         if (payload?.type !== "playSFX") return
         this.receiveSocketAudio(payload)
      })
   }

   static _playPayloadLocal(path, volume = 0.8) {
      if (globalThis.document?.hidden) return
      return foundry.audio.AudioHelper.play({ src: path, volume }, false)
   }

   static receiveSocketAudio(payload = {}) {
      const path = payload.path || payload.src
      if (!path) return false
      if (payload.originUserId === game.user?.id) return false
      const targets = Array.isArray(payload.targetUserIds)
         ? payload.targetUserIds
         : null
      if (targets && !targets.includes(game.user?.id)) return false
      if (this._hasSeenAudioPacket(payload.id)) return false
      this._markAudioPacket(payload.id)
      this._playPayloadLocal(path, payload.volume ?? 0.8)
      return true
   }

   static _hasSeenAudioPacket(id) {
      if (!id) return false
      this._seenAudioPackets = this._seenAudioPackets || new Map()
      const seenAt = this._seenAudioPackets.get(id)
      if (!seenAt) return false
      return Date.now() - seenAt < 10000
   }

   static _markAudioPacket(id) {
      if (!id) return
      this._seenAudioPackets = this._seenAudioPackets || new Map()
      const now = Date.now()
      this._seenAudioPackets.set(id, now)
      for (const [key, time] of this._seenAudioPackets) {
         if (now - time > 10000) this._seenAudioPackets.delete(key)
      }
   }

   static _audioPacket(path, targetUserIds = null, volume = 0.8) {
      const randomId =
         foundry.utils?.randomID?.() ||
         `${Date.now()}-${Math.random().toString(36).slice(2)}`
      return {
         type: "playSFX",
         id: randomId,
         path,
         volume,
         targetUserIds: Array.isArray(targetUserIds)
            ? targetUserIds.filter(Boolean)
            : null,
         originUserId: game.user?.id,
      }
   }

   static _playOwnAudioPacket(packet) {
      if (this._hasSeenAudioPacket(packet.id)) return false
      this._markAudioPacket(packet.id)
      this._playPayloadLocal(packet.path, packet.volume)
      return true
   }

   static _emitGameSocketAudio(packet) {
      if (!game.socket?.emit) return false
      game.socket.emit(`module.${MODULE_ID}`, packet)
      return true
   }

   static _emitSocketlibAudio(packet) {
      if (!game.modules.get("socketlib")?.active || !globalThis.siegeSocket)
         return false
      const targets = Array.isArray(packet.targetUserIds)
         ? packet.targetUserIds
         : null
      try {
         if (!targets) {
            const result = globalThis.siegeSocket.executeForEveryone(
               "playSFX",
               packet,
            )
            result?.catch?.(() => {})
            return true
         }
         let sent = false
         for (const id of targets) {
            sent = this._socketPlayUser(id, packet) || sent
         }
         return sent
      } catch {
         return false
      }
   }

   static _socketPlayUser(userId, packet) {
      if (!userId) return false
      if (userId === game.user?.id) {
         this._playOwnAudioPacket(packet)
         return true
      }
      if (!game.modules.get("socketlib")?.active || !globalThis.siegeSocket)
         return false
      try {
         const result = globalThis.siegeSocket.executeAsUser(
            "playSFX",
            userId,
            packet,
         )
         result?.catch?.(() => {})
         return true
      } catch {
         return false
      }
   }

   static _broadcast(path, playGlobally = true, sourceUserId = null, options = {}) {
      const volume = 0.8
      const exclude = new Set(options.excludeUserIds || [])
      const targets = playGlobally
         ? this._activeAudioUserIds().filter((id) => !exclude.has(id))
         : sourceUserId
           ? exclude.has(sourceUserId)
              ? []
              : [sourceUserId]
           : game.user?.id
             ? exclude.has(game.user.id)
                ? []
                : [game.user.id]
             : null
      if (Array.isArray(targets) && targets.length === 0) return false
      const packet = this._audioPacket(path, targets, volume)
      const shouldPlayHere =
         !packet.targetUserIds ||
         packet.targetUserIds.includes(game.user?.id)
      if (shouldPlayHere) this._playOwnAudioPacket(packet)
      const sentNative = this._emitGameSocketAudio(packet)
      const sentSocketlib = this._emitSocketlibAudio(packet)
      if (!shouldPlayHere && !sentNative && !sentSocketlib)
         this._playPayloadLocal(path, volume)
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

const actionRows = []
      for (const a of otherActions) {
         actionRows.push(row(`action-${a.id}`, a.name))
         if (a.getFlag(MODULE_ID, "siegeAction")?.isLightActivate)
            actionRows.push(
               row(
                  `action-${a.id}-off`,
                  tKey("SFX.LightOffPrefix", { name: a.name }),
               ),
            )
      }

const movementRows = [
         row("movement-continuous", tKey("SFX.MovementContinuous")),
         row("movement-start", tKey("SFX.MovementStart")),
         row("movement-end", tKey("SFX.MovementEnd")),
         row("rotate", tKey("SFX.Rotate")),
      ]
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
