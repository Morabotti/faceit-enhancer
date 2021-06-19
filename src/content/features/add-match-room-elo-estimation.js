/** @jsx h */
import { h } from 'dom-chef'
import select from 'select-dom'
import {
  getTeamElements,
  getRoomId,
  getTeamMemberElements,
  getNicknameElement,
  getFactionDetails,
  mapMatchNicknamesToPlayersMemoized
} from '../helpers/match-room'
import {
  getQuickMatch,
  getMatch,
  getUser,
  getSelf
} from '../helpers/faceit-api'
import {
  hasFeatureAttribute,
  setFeatureAttribute,
  setStyle
} from '../helpers/dom-element'
import {
  estimateRatingChangeMemoized,
  predictRatingChange
} from '../helpers/elo'
import storage from '../../shared/storage'

const FEATURE_ATTRIBUTE = 'elo-estimation'

export default async (parent) => {
  const { teamElements, isTeamV1Element } = getTeamElements(parent)

  const roomId = getRoomId()
  const match = isTeamV1Element
    ? await getQuickMatch(roomId)
    : await getMatch(roomId)

  if (!match || match.state === 'FINISHED') {
    return
  }

  const nicknamesToPlayers = mapMatchNicknamesToPlayersMemoized(match)
  const { matchRoomFocusMode } = await storage.getAll()
  const self = await getSelf()

  if (nicknamesToPlayers[self.nickname] && matchRoomFocusMode) {
    return
  }

  let factions = await Promise.all(
    teamElements.map(async (teamElement) => {
      const factionDetails = getFactionDetails(teamElement, isTeamV1Element)

      if (!factionDetails) {
        return
      }

      const { factionName } = factionDetails
      const factionElo = match[`${factionName}Elo`]

      let averageElo

      if (factionElo) {
        averageElo = factionElo
      } else {
        const memberElements = getTeamMemberElements(teamElement)

        let memberElos = await Promise.all(
          memberElements.map(async (memberElement) => {
            const nicknameElement = getNicknameElement(
              memberElement,
              isTeamV1Element
            )

            if (!nicknameElement) {
              return
            }

            const nickname = nicknameElement.textContent
            const player = nicknamesToPlayers[nickname]

            let userId
            if (isTeamV1Element) {
              userId = player.guid
            } else {
              userId = player.id
            }

            const user = await getUser(userId)

            if (!user) {
              return
            }

            const { game } = match
            const elo = user.games[game].faceitElo || null

            return elo
          })
        )

        memberElos = memberElos.filter((m) => Boolean(m))

        const totalElo = memberElos.reduce((acc, curr) => acc + curr, 0)
        averageElo = Math.floor(totalElo / memberElos.length)
      }

      return {
        factionName,
        averageElo
      }
    })
  )

  factions = factions.filter((faction) => Boolean(faction))

  if (factions.length !== 2) {
    return
  }

  let eloElements = factions.map((faction, i) => {
    const { factionName, averageElo } = faction

    const factionNameElement = select(
      `h2[ng-bind*="${
        isTeamV1Element
          ? `match.${factionName}_nickname`
          : `vm.currentMatch.match.teams.${factionName}.name`
      }"]`,
      parent
    )

    if (
      !factionNameElement ||
      hasFeatureAttribute(FEATURE_ATTRIBUTE, factionNameElement)
    ) {
      return null
    }

    setFeatureAttribute(FEATURE_ATTRIBUTE, factionNameElement)

    const opponentAverageElo = factions[1 - i].averageElo

    let gain
    let loss

    if (match.teams[factionName].stats) {
      const predicatedRatingChange = predictRatingChange(
        match.teams[factionName].stats.winProbability
      )

      gain = predicatedRatingChange.gain
      loss = predicatedRatingChange.loss
    } else {
      const estimatedRatingChange = estimateRatingChangeMemoized(
        averageElo,
        opponentAverageElo
      )

      gain = estimatedRatingChange.gain
      loss = estimatedRatingChange.loss
    }

    const eloDiff = averageElo - opponentAverageElo

    const eloElement = (
      <div className="text-muted text-md" style={{ 'margin-top': 6 }}>
        Avg. Elo: {averageElo} / Diff: {eloDiff > 0 ? `+${eloDiff}` : eloDiff}
        <br />
        <span>Est. Gain: +{gain}</span> / <span>Est. Loss: {loss}</span>
      </div>
    )

    factionNameElement.style.lineHeight = 'normal'
    factionNameElement.append(eloElement)

    const factionIndex = i + 1
    const scoreElement = select(
      isTeamV1Element
        ? `span[ng-bind="match.score${factionIndex}"]`
        : `span[ng-bind="vm.currentMatch.match.results.score.faction${factionIndex}"]`
    )

    if (scoreElement && !hasFeatureAttribute(FEATURE_ATTRIBUTE, scoreElement)) {
      setFeatureAttribute(FEATURE_ATTRIBUTE, scoreElement)

      const points = parseFloat(scoreElement.textContent) === 1 ? gain : loss

      const pointsElement = (
        <div className="text-lg">{points > 0 ? `+${points}` : points}</div>
      )

      setStyle(scoreElement, 'margin-top: -41px')
      scoreElement.append(pointsElement)
    }

    return eloElement
  })

  eloElements = eloElements.filter((eloElement) => Boolean(eloElement))

  if (eloElements.length !== 2) {
    return
  }

  const observer = new MutationObserver(() => {
    const firstResultElement = select('div[class*="MatchScore__Result"')

    if (!firstResultElement) {
      return
    }

    const result = firstResultElement.textContent

    if (result === 'W' || result === 'L') {
      eloElements.forEach((eloElement) => {
        eloElement.remove()
      })
      observer.disconnect()
    }
  })

  const matchResultElement = select('div[class*=VersusTeamStatus__Holder]')

  observer.observe(matchResultElement, { childList: true, subtree: true })
}
