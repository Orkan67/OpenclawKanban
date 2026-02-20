import React, { useState, useEffect } from 'react'
import './Dashboard.css'

function Dashboard({ projects }) {
  const [activities, setActivities] = useState([])
  const [subagents, setSubagents] = useState([])
  const [agentFeed, setAgentFeed] = useState([])

  useEffect(() => {
    fetchRecentActivities()
    fetchSubagents()
    fetchAgentFeed()
    // Poll subagent status every 5 seconds (live tracking)
    const subagentInterval = setInterval(fetchSubagents, 5000)
    // Poll agent feed every 3 seconds for live updates
    const feedInterval = setInterval(fetchAgentFeed, 3000)
    return () => {
      clearInterval(subagentInterval)
      clearInterval(feedInterval)
    }
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

  const fetchAgentFeed = async () => {
    try {
      const response = await fetch('/api/agent-feed?limit=30')
      const data = await response.json()
      setAgentFeed(data.feed || [])
    } catch (error) {
      console.error('Error fetching agent feed:', error)
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

    const workingAgents = subagents.filter(a => a.status === 'working').length

    return { totalTasks, completedTasks, inProgressTasks, workingAgents }
  }

  const stats = calculateStats()

  const getAgentColor = (agent) => {
    const colors = {
      'CODEAGENT': '#3b82f6',
      'REVAGENT': '#8b5cf6',
      'ORCHESTRATOR': '#f97316',
      'KBAGENT': '#ec4899'
    }
    return colors[agent] || '#6b7280'
  }

  const formatFeedTime = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now - date
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    
    if (diffSec < 10) return 'gerade eben'
    if (diffSec < 60) return `vor ${diffSec}s`
    if (diffMin < 60) return `vor ${diffMin}m`
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  const truncateText = (text, max = 150) => {
    if (!text) return ''
    // Remove markdown headers and clean up
    const cleaned = text.replace(/^#+\s/gm, '').replace(/\*\*/g, '').trim()
    if (cleaned.length <= max) return cleaned
    return cleaned.substring(0, max) + '…'
  }

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
        <div className={`stat-card stat-agents ${stats.workingAgents > 0 ? 'stat-agents-active' : ''}`}>
          <div className="stat-value">{stats.workingAgents}</div>
          <div className="stat-label">🤖 Agents aktiv</div>
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

      {/* 📡 Live Agent Feed */}
      <div className="agent-feed-section">
        <h2>📡 Live Agent Feed</h2>
        <div className="agent-feed-container">
          {agentFeed.length > 0 ? (
            agentFeed.map((item, index) => (
              <div key={index} className="feed-item">
                <div className="feed-item-header">
                  <span 
                    className="feed-agent-badge"
                    style={{ backgroundColor: getAgentColor(item.agent) + '22', color: getAgentColor(item.agent), borderColor: getAgentColor(item.agent) + '44' }}
                  >
                    {item.agent}
                  </span>
                  {item.label && (
                    <span className="feed-label">{item.label}</span>
                  )}
                  <span className="feed-time">{formatFeedTime(item.timestamp)}</span>
                </div>
                <div className="feed-item-body">
                  {item.text && (
                    <div className="feed-text">{truncateText(item.text)}</div>
                  )}
                  {item.toolCalls && item.toolCalls.map((tc, i) => (
                    <div key={i} className="feed-tool-call">
                      <span className="feed-tool-icon">⚡</span>
                      <span className="feed-tool-name">{tc.tool}</span>
                      <span className="feed-tool-args">{truncateText(tc.args, 100)}</span>
                    </div>
                  ))}
                  {item.toolResult && (
                    <div className={`feed-tool-result ${item.toolResult.isError ? 'feed-tool-error' : ''}`}>
                      <span className="feed-tool-icon">{item.toolResult.isError ? '❌' : '✅'}</span>
                      <span className="feed-tool-name">{item.toolResult.tool}</span>
                      <span className="feed-tool-output">{truncateText(item.toolResult.output, 120)}</span>
                    </div>
                  )}
                </div>
                {item.model && (
                  <div className="feed-model">{item.model}</div>
                )}
              </div>
            ))
          ) : (
            <div className="feed-empty">
              <p>💤 Keine aktiven Agent-Aktivitäten</p>
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
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
