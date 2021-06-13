import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import DOMPurify from 'dompurify'
import SwipeableViews from 'react-swipeable-views'
import { virtualize } from 'react-swipeable-views-utils'

import ListGroup from 'react-bootstrap/ListGroup'
import Modal from 'react-bootstrap/Modal'
import Button from 'react-bootstrap/Button'
import Dropdown from 'react-bootstrap/Dropdown'
import ReactPlaceholder from 'react-placeholder'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'

import AppBody from '../components/AppBody'
import AppNavbar from '../components/AppNavbar'
import AppTabbar from '../components/AppTabbar'
import { callWithSession, NoSessionError } from '../lib/thi-backend/thi-session-handler'
import { getTimetable } from '../lib/thi-backend/thi-api-client'
import { addWeek, DATE_LOCALE, formatFriendlyTime, getFriendlyWeek, getWeek } from '../lib/date-utils'

import styles from '../styles/Timetable.module.css'

const VirtualizeSwipeableViews = virtualize(SwipeableViews)

export function getTimetableEntryName (item) {
  const match = item.veranstaltung.match(/^[A-Z]{2}\S*/)
  if (match) {
    const [shortName] = match
    return {
      name: item.fach,
      shortName: shortName,
      fullName: `${shortName} - ${item.fach}`
    }
  } else {
    // fallback for weird entries like
    //    "veranstaltung": "„Richtige Studienorganisation und Prüfungsplanung“_durchgeführt von CSS und SCS",
    //    "fach": "fiktiv für Raumbelegung der Verwaltung E",
    const name = `${item.veranstaltung} - ${item.fach}`
    const shortName = name.length < 10 ? name : name.substr(0, 10) + '…'
    return {
      name,
      shortName,
      fullName: name
    }
  }
}

export async function getFriendlyTimetable (detailed) {
  const now = new Date()
  const { timetable } = await callWithSession(session => getTimetable(session, now, detailed))

  return timetable
    .map(x => {
      // parse dates
      x.startDate = new Date(`${x.datum}T${x.von}`)
      x.endDate = new Date(`${x.datum}T${x.bis}`)

      // normalize room order
      x.raum = x.raum
        .split(',')
        .map(x => x.trim().toUpperCase())
        .sort()
        .join(', ')

      return x
    })
    .filter(x => x.endDate > now)
    .sort((a, b) => a.startDate - b.startDate)
}

function groupTimetableEntries (timetable) {
  // get all available dates and remove duplicates
  const dates = timetable
    .map(x => x.datum)
    .filter((v, i, a) => a.indexOf(v) === i)

  // get events for each date
  const groups = dates.map(date => ({
    date: date,
    items: timetable.filter(x => x.datum === date)
  }))

  return groups
}

function isToday (date) {
  return new Date(date).setHours(0, 0, 0, 0) === new Date().setHours(0, 0, 0, 0)
}

function isInWeek (date, start, end) {
  date = new Date(date)
  return date > start && date < end
}

function getDay (date) {
  return new Date(date).toLocaleDateString(DATE_LOCALE, { day: 'numeric' })
}

function getWeekday (date) {
  return new Date(date).toLocaleDateString(DATE_LOCALE, { weekday: 'short' })
}

export default function Timetable () {
  const router = useRouter()
  const [timetable, setTimetable] = useState(null)
  const [focusedEntry, setFocusedEntry] = useState(null)
  const [isDetailedData, setIsDetailedData] = useState(false)
  const [showTimetableExplanation, setShowTimetableExplanation] = useState(false)
  const [showICalExplanation, setShowICalExplanation] = useState(false)

  // page (0 = current week)
  const [page, setPage] = useState(0)

  // week for the caption
  const week = useMemo(() => {
    const [currStart, currEnd] = getWeek(new Date())
    return [addWeek(currStart, page), addWeek(currEnd, page)]
  }, [page])

  useEffect(async () => {
    // we need to load data only if we have not done it yet or if we have no
    // detailed data but want to display an entry in detail
    if (timetable && (!focusedEntry || isDetailedData)) {
      return
    }

    try {
      const detailed = !!focusedEntry
      const ungroupedData = await getFriendlyTimetable(detailed)
      const groupedData = groupTimetableEntries(ungroupedData)
      setTimetable(groupedData)
      setIsDetailedData(detailed)

      if (focusedEntry) {
        // find the focused entry in the new data
        const detailedEntry = groupedData
          .map(group => group.items.find(x =>
            x.datum === focusedEntry.datum &&
            x.veranstaltung === focusedEntry.veranstaltung)
          )
          .find(x => x)

        if (detailedEntry) {
          setFocusedEntry(detailedEntry)
        } else {
          // just keep the old entry. The user wont see goals, content or literature
          console.error('could not find the focused timetable entry in new detailed data')
        }
      }
    } catch (e) {
      if (e instanceof NoSessionError) {
        router.replace('/login')
      } else {
        console.error(e)
        alert(e)
      }
    }
  }, [focusedEntry])

  function timetableRenderer ({ key, index }) {
    const [start, end] = getWeek(new Date()).map(date => addWeek(date, index))
    const current = timetable && timetable.filter(group => isInWeek(group.date, start, end))

    return (
      <div key={key}>
        {current && current.map((group, idx) =>
          <div key={idx} className={`${styles.day} ${isToday(group.date) && styles.today}`}>
            <div className={`text-muted ${styles.heading}`}>
              <div className={styles.date}>
                {getDay(group.date)}
              </div>
              <div className={styles.weekday}>
                {getWeekday(group.date)}
              </div>
            </div>

            <ListGroup className={styles.items} variant="flush">
              {group.items.map((item, idx) =>
                <ListGroup.Item key={idx} className={styles.item} onClick={() => setFocusedEntry(item)} action>
                  <div className={styles.left}>
                    <div className={styles.name}>
                      {getTimetableEntryName(item).fullName}
                    </div>
                    <div className={styles.room}>
                      {item.raum}
                    </div>
                  </div>
                  <div className={styles.right}>
                    {formatFriendlyTime(item.startDate)} <br />
                    {formatFriendlyTime(item.endDate)}
                  </div>
                </ListGroup.Item>
              )}
            </ListGroup>
          </div>
        )}
        {current && current.length === 0 &&
          <div className={`text-muted ${styles.notice}`}>
            Keine Veranstaltungen. 🎉
          </div>
        }
      </div>
    )
  }

  return (
    <>
      <AppNavbar title="Stundenplan" showBack={'desktop-only'}>
        <Dropdown.Item variant="link" onClick={() => setShowTimetableExplanation(true)}>
          Fächer bearbeiten
        </Dropdown.Item>
        <Dropdown.Item variant="link" onClick={() => setShowICalExplanation(true)}>
          Kalender Integration (iCal)
        </Dropdown.Item>
      </AppNavbar>

      <AppBody>
        <Modal size="lg" show={showTimetableExplanation} onHide={() => setShowTimetableExplanation(false)}>
          <Modal.Header closeButton>
            <Modal.Title>Fächer bearbeiten</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            Aktuell können die Fächer für den persönlichen Stundenplan leider nur in Primuss bearbeitet werden:
            <ul>
              <li>In &quot;myStundenplan&quot; einloggen</li>
              <li>Links auf &quot;Fächerauswahl&quot; klicken</li>
              <li>Studiengang auswählen und unten abspeichern</li>
              <li>Oben auf &quot;Studiengruppen&quot; klicken</li>
              <li>Semestergruppe auswählen und unten abspeichern</li>
              <li>Oben auf den Studiengang klicken</li>
              <li>Fächer auswählen und unten abspeichern</li>
            </ul>

            {/* TODO: Video? */}
          </Modal.Body>
          <Modal.Footer>
            <a href="https://www3.primuss.de/stpl/login.php?FH=fhin&Lang=de" target="_blank" rel="noreferrer">
              <Button variant="primary">
                Zu &quot;myStundenplan&quot;
              </Button>
            </a>
            <Button variant="secondary" onClick={() => setShowTimetableExplanation(false)}>
              Schließen
            </Button>
          </Modal.Footer>
        </Modal>

        <Modal size="lg" show={showICalExplanation} onHide={() => setShowICalExplanation(false)}>
          <Modal.Header closeButton>
            <Modal.Title>iCal Integration</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            Der persönliche Stundenplan kann per iCal URL in eine bestehende Kalender App integriert werden.
            Die iCal URL findest du aktuell nur in Primuss:
            <ul>
              <li>In &quot;myStundenplan&quot; einloggen</li>
              <li>Links auf &quot;Aktueller Stundenplan&quot; klicken</li>
              <li>Oben auf &quot;Extern&quot; klicken</li>
              <li>Unter &quot;Termine Abonnieren&quot; auf &quot;Link anzeigen&quot; klicken</li>
            </ul>

            {/* TODO: Video? */}
          </Modal.Body>
          <Modal.Footer>
            <a href="https://www3.primuss.de/stpl/login.php?FH=fhin&Lang=de" target="_blank" rel="noreferrer">
              <Button variant="primary">
                Zu &quot;myStundenplan&quot;
              </Button>
            </a>
            <Button variant="secondary" onClick={() => setShowICalExplanation(false)}>
              Schließen
            </Button>
          </Modal.Footer>
        </Modal>

        <Modal size="lg" show={!!focusedEntry} onHide={() => setFocusedEntry(null)}>
          <Modal.Header closeButton>
            <Modal.Title>{focusedEntry && getTimetableEntryName(focusedEntry).name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <h5>Allgemein</h5>
            <p>
              <strong>Dozent</strong>: {focusedEntry && focusedEntry.dozent}<br />
              <strong>Prüfung</strong>: {focusedEntry && focusedEntry.pruefung}<br />
              <strong>Studiengang</strong>: {focusedEntry && focusedEntry.stg}<br />
              <strong>Studiengruppe</strong>: {focusedEntry && focusedEntry.stgru}<br />
              <strong>Semesterwochenstunden</strong>: {focusedEntry && focusedEntry.sws}<br />
              <strong>ECTS</strong>: {focusedEntry && focusedEntry.ectspoints}<br />
            </p>

            <h5>Ziel</h5>
            <ReactPlaceholder type="text" rows={5} ready={isDetailedData}>
              {focusedEntry && focusedEntry.ziel && (
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(focusedEntry.ziel) }}></div>
              )}
              {focusedEntry && !focusedEntry.ziel && (
                <p>Keine Angabe</p>
              )}
            </ReactPlaceholder>

            <h5>Inhalt</h5>
            <ReactPlaceholder type="text" rows={5} ready={isDetailedData}>
              {focusedEntry && focusedEntry.inhalt && (
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(focusedEntry.inhalt) }}></div>
              )}
              {focusedEntry && !focusedEntry.inhalt && (
                <p>Keine Angabe</p>
              )}
            </ReactPlaceholder>

            <h5>Literatur</h5>
            <ReactPlaceholder type="text" rows={5} ready={isDetailedData}>
              {focusedEntry && focusedEntry.literatur && (
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(focusedEntry.literatur) }}></div>
              )}
              {focusedEntry && !focusedEntry.literatur && (
                <p>Keine Angabe</p>
              )}
            </ReactPlaceholder>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setFocusedEntry(null)}>
              Schließen
            </Button>
          </Modal.Footer>
        </Modal>

        <div className={styles.weekSelector}>
          <Button className={styles.prevWeek} variant="link" onClick={() => setPage(idx => idx - 1)}>
            <FontAwesomeIcon icon={faChevronLeft} />
          </Button>
          <div className={styles.currentWeek}>
            {getFriendlyWeek(week[0])}
          </div>
          <Button className={styles.nextWeek} variant="link" onClick={() => setPage(idx => idx + 1)}>
            <FontAwesomeIcon icon={faChevronRight} />
          </Button>
        </div>

        <ReactPlaceholder type="text" rows={20} ready={timetable}>
          {timetable && timetable.length > 0 &&
            <VirtualizeSwipeableViews slideRenderer={timetableRenderer} index={page} onChangeIndex={idx => setPage(idx)} />
          }
          {timetable && timetable.length === 0 &&
            <div className={`text-muted ${styles.notice}`}>
              <p>
                Dein Stundenplan ist aktuell leer.
              </p>
              <p>
                Du kannst deinen Stundenplan im{' '}
                <a href="https://www3.primuss.de/stpl/login.php?FH=fhin&Lang=de">
                Stundenplantool der THI zusammenstellen</a>, dann erscheinen hier
                die gewählten Fächer.
              </p>
            </div>
          }
        </ReactPlaceholder>
      </AppBody>

      <AppTabbar />
    </>
  )
}
