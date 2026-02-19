import React, { useState, useEffect } from 'react'
import './Dashboard.css'

function Dashboard({ projects }) {
  const [activities, setActivities] = useState([])
  const [subagents, setSubagents] = useState([])

  useEffect(() => {
    fetchRecentActivities()
    fetchSubagents()
    // Poll subagent status every 5 seconds (live tracking)
    const interval = setInterval(fetchSubagents, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchRecentActivities = async () => {
    try {
      const response = await fetch('/api/activity?limit=10')
      const data = await response.json()
      setActivities(data.activities || [])
    } catch (error) {
      console.error('Error fetching activities:', error)
    }
  }

  const fetchSubagents = async () => {
    try {
      const response = await fetch('/api/subagents')
      const data = await response.json()
      setSubagents(data.subagents || [])
    } catch (error) {
      console.error('Error fetching subagents:', error)
    }
  }

  const calculateStats = () => {
    let totalTasks = 0
    let completedTasks = 0
    let inProgressTasks = 0
    
    projects.forEach(project => {
      const tasks = project.tasks || []
      totalTasks += tasks.length
      completedTasks += tasks.filter(t => t.status === 'done').length
      inProgressTasks += tasks.filter(t => t.status === 'in-progress').length
    })

    return { totalTasks, completedTasks, inProgressTasks }
  }

  const stats = calculateStats()

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p>Überblick über alle Projekte und Aktivitäten</p>
      </div>

      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-value">{projects.length}</div>
          <div className="stat-label">Projekte</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalTasks}</div>
          <div className="stat-label">Aufgaben gesamt</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.inProgressTasks}</div>
          <div className="stat-label">In Arbeit</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.completedTasks}</div>
          <div className="stat-label">Erledigt</div>
        </div>
      </div>

      {/* 🚨 Agent Meldungsfenster */}
      <div className="agent-alert-section">
        <h2>🚨 Agent Meldungsfenster (Status & Aktivität)</h2>
        <div className="agent-alert-container">
          {subagents && subagents.length > 0 ? (
            subagents.map(agent => {
              const statusEmoji = agent.status === 'working' ? '🔄' : agent.status === 'idle' ? '🟢' : '🔴'
              const statusText = agent.status === 'working' ? 'ARBEITET...' : agent.status === 'idle' ? 'VERFÜGBAR' : 'FEHLER'
              const alertColor = agent.status === 'working' ? 'warning' : agent.status === 'idle' ? 'info' : 'error'
              
              return (
                <div key={agent.id} className={`alert-card alert-${alertColor}`}>
                  <div className="alert-header">
                    <span className="alert-emoji">{statusEmoji}</span>
                    <div className="alert-info">
                      <div className="alert-title">{agent.name}</div>
                      <div className="alert-agent-id">{agent.id}</div>
                    </div>
                  </div>
                  <div className="alert-status">
                    <span className={`status-badge ${agent.status}`}>{statusText}</span>
                    {agent.lastUpdate && (
                      <span className="alert-time">
                        {new Date(agent.lastUpdate).toLocaleTimeString('de-DE')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="alert-empty">
              <p>🔄 Agenten werden geladen...</p>
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-projects">
          <h2>📁 Projekte</h2>
          <div className="project-grid">
            {projects.map(project => (
              <div 
                key={project.id} 
                className="project-card"
                style={{ borderTopColor: project.color }}
              >
                <h3>{project.name}</h3>
                <p>{project.description || 'Keine Beschreibung'}</p>
                <div className="project-stats">
                  <span>📋 {project.tasks?.length || 0} Aufgaben</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-activity">
          <h2>📜 Letzte Aktivitäten</h2>
          <div className="activity-list">
            {activities.length === 0 ? (
              <p className="no-activities">Keine Aktivitäten</p>
            ) : (
              activities.map((activity, index) => (
                <div key={activity.id || index} className={`activity-item activity-${activity.type || 'default'}`}>
                  <div className="activity-time">
                    {new Date(activity.timestamp).toLocaleTimeString('de-DE')}
                  </div>
                  <div className="activity-content">
                    {activity.title && <div className="activity-title">{activity.title}</div>}
                    {activity.message && <div className="activity-message">{activity.message}</div>}
                    {activity.description && <div className="activity-description">{activity.description}</div>}
                  </div>
                  <div className={`activity-badge ${activity.status || 'default'}`}>
                    {activity.status || activity.type || 'info'}
                  </div>
                </div>
              ))
            )}}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard