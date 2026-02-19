import React, { useState, useEffect } from 'react'
import './Activities.css'

function Activities() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchActivities()
  }, [])

  const fetchActivities = async () => {
    try {
      const response = await fetch('/api/activity')
      const data = await response.json()
      setActivities(data.activities || [])
    } catch (error) {
      console.error('Error fetching activities:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (timestamp) => {
    const date = new Date(timestamp)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return `Heute, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Gestern, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    } else {
      return date.toLocaleString('de-DE')
    }
  }

  if (loading) {
    return <div className="activities-loading">Lade Aktivitäten...</div>
  }

  return (
    <div className="activities-page">
      <div className="activities-header">
        <h1>📜 Aktivitäten</h1>
        <p>Chronologische Übersicht aller Projektaktivitäten</p>
      </div>

      <div className="activities-timeline">
        {activities.length === 0 ? (
          <div className="no-activities">Keine Aktivitäten vorhanden</div>
        ) : (
          activities.map((activity, index) => (
            <div key={activity.id || index} className="timeline-item">
              <div className="timeline-marker"></div>
              <div className="timeline-content">
                <div className="timeline-header">
                  <span className="timeline-date">{formatDate(activity.timestamp)}</span>
                  <span className={`timeline-status ${activity.status}`}>
                    {activity.status}
                  </span>
                </div>
                <div className="timeline-body">
                  <h3>{activity.message || activity.title}</h3>
                  <p>{activity.description}</p>
                  {activity.metadata && (
                    <div className="timeline-meta">
                      {activity.metadata.projectName && (
                        <span className="meta-tag">
                          📁 {activity.metadata.projectName}
                        </span>
                      )}
                      {activity.metadata.taskCount && (
                        <span className="meta-tag">
                          📋 {activity.metadata.taskCount} Aufgaben
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Activities