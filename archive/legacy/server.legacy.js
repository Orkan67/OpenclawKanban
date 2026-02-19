import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { v4 as uuidv4 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.text())

// Serve static files (HTML, CSS, JS)
app.use(express.static(__dirname))

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// Initialize data files if they don't exist
const tasksFile = path.join(dataDir, 'tasks.json')
const activityFile = path.join(dataDir, 'activity.json')

if (!fs.existsSync(tasksFile)) {
  fs.writeFileSync(tasksFile, JSON.stringify({ projects: [] }, null, 2))
}

if (!fs.existsSync(activityFile)) {
  fs.writeFileSync(activityFile, JSON.stringify({ activities: [] }, null, 2))
}

// Helper functions
const readTasksData = () => {
  try {
    return JSON.parse(fs.readFileSync(tasksFile, 'utf8'))
  } catch (error) {
    return { projects: [] }
  }
}

const writeTasksData = (data) => {
  fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2))
}

const readActivityData = () => {
  try {
    return JSON.parse(fs.readFileSync(activityFile, 'utf8'))
  } catch (error) {
    return { activities: [] }
  }
}

const writeActivityData = (data) => {
  fs.writeFileSync(activityFile, JSON.stringify(data, null, 2))
}

const addActivity = (action, title, description, metadata = {}) => {
  const data = readActivityData()
  data.activities.unshift({
    id: `act-${uuidv4()}`,
    timestamp: new Date().toISOString(),
    action,
    title,
    description,
    metadata,
    status: 'completed'
  })
  writeActivityData(data)
}

// API Routes

// Get all projects
app.get('/api/projects', (req, res) => {
  const data = readTasksData()
  res.json(data)
})

// Create new project
app.post('/api/projects', (req, res) => {
  const { name, description, docs } = req.body
  
  if (!name) {
    return res.status(400).json({ error: 'Project name is required' })
  }
  
  const data = readTasksData()
  const newProject = {
    id: `proj-${uuidv4().slice(0, 8)}`,
    name,
    description: description || '',
    docs: docs || '',
    color: '#' + Math.floor(Math.random()*16777215).toString(16),
    tasks: [],
    createdAt: new Date().toISOString()
  }
  
  data.projects.push(newProject)
  writeTasksData(data)
  
  addActivity('project_created', 'Projekt erstellt', `${name} wurde erstellt`, {
    projectId: newProject.id,
    projectName: name
  })
  
  res.json(newProject)
})

// Get single project
app.get('/api/projects/:projectId', (req, res) => {
  const data = readTasksData()
  const project = data.projects.find(p => p.id === req.params.projectId)
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' })
  }
  
  res.json(project)
})

// Delete project
app.delete('/api/projects/:projectId', (req, res) => {
  const data = readTasksData()
  const projectIndex = data.projects.findIndex(p => p.id === req.params.projectId)
  
  if (projectIndex === -1) {
    return res.status(404).json({ error: 'Project not found' })
  }
  
  const project = data.projects[projectIndex]
  data.projects.splice(projectIndex, 1)
  writeTasksData(data)
  
  addActivity('project_deleted', 'Projekt gelöscht', `${project.name} wurde entfernt`, {
    projectId: project.id,
    projectName: project.name
  })
  
  res.json({ success: true, message: 'Project deleted' })
})

// Get project files
app.get('/api/projects/:projectId/files', (req, res) => {
  const data = readTasksData()
  const project = data.projects.find(p => p.id === req.params.projectId)
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' })
  }
  
  if (!project.projectPath) {
    return res.json({ error: 'No project path', needsPath: true })
  }
  
  const projectPath = project.projectPath
  
  // Security: check if path exists and is readable
  if (!fs.existsSync(projectPath)) {
    return res.json({ error: 'Project path does not exist' })
  }
  
  try {
    const tree = buildFileTree(projectPath, projectPath)
    res.json({ tree })
  } catch (error) {
    console.error('File tree error:', error)
    res.json({ error: 'Failed to read directory' })
  }
})

// Helper function to build file tree
function buildFileTree(dirPath, basePath, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) return []
  
  const items = []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  
  // Filter out hidden files and common ignore patterns
  const filtered = entries.filter(entry => {
    const name = entry.name
    if (name.startsWith('.')) return false
    if (name === 'node_modules') return false
    if (name === '__pycache__') return false
    if (name === '.git') return false
    return true
  })
  
  // Sort: directories first, then files
  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })
  
  for (const entry of filtered) {
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(basePath, fullPath)
    
    if (entry.isDirectory()) {
      const children = buildFileTree(fullPath, basePath, maxDepth, currentDepth + 1)
      items.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        icon: '📁',
        children
      })
    } else {
      const ext = path.extname(entry.name)
      let icon = '📄'
      
      // Icon based on file extension
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) icon = '📜'
      if (['.json', '.yaml', '.yml'].includes(ext)) icon = '⚙️'
      if (['.md', '.txt'].includes(ext)) icon = '📝'
      if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) icon = '🖼️'
      if (['.py'].includes(ext)) icon = '🐍'
      if (['.css', '.scss', '.sass'].includes(ext)) icon = '🎨'
      
      items.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        icon
      })
    }
  }
  
  return items
}

// Read single file content
app.get('/api/projects/:projectId/files/*', (req, res) => {
  const data = readTasksData()
  const project = data.projects.find(p => p.id === req.params.projectId)
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' })
  }
  
  if (!project.projectPath) {
    return res.json({ error: 'No project path' })
  }
  
  // Get file path from wildcard
  const filePath = req.params[0]
  const fullPath = path.join(project.projectPath, filePath)
  
  // Security: ensure path is within project directory
  const relativePath = path.relative(project.projectPath, fullPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return res.status(403).json({ error: 'Access denied' })
  }
  
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' })
  }
  
  try {
    const stats = fs.statSync(fullPath)
    
    if (stats.isDirectory()) {
      return res.json({ error: 'Path is a directory' })
    }
    
    const content = fs.readFileSync(fullPath, 'utf8')
    const ext = path.extname(filePath)
    const name = path.basename(filePath)
    
    let icon = '📄'
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) icon = '📜'
    if (['.json', '.yaml', '.yml'].includes(ext)) icon = '⚙️'
    if (['.md', '.txt'].includes(ext)) icon = '📝'
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) icon = '🖼️'
    if (['.py'].includes(ext)) icon = '🐍'
    if (['.css', '.scss', '.sass'].includes(ext)) icon = '🎨'
    
    res.json({
      content,
      name,
      extension: ext,
      icon
    })
  } catch (error) {
    console.error('File read error:', error)
    res.status(500).json({ error: 'Failed to read file' })
  }
})

// Add task to project
app.post('/api/projects/:projectId/tasks', (req, res) => {
  const { title, description, status, priority } = req.body
  
  if (!title) {
    return res.status(400).json({ error: 'Task title is required' })
  }
  
  const data = readTasksData()
  const project = data.projects.find(p => p.id === req.params.projectId)
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' })
  }
  
  const newTask = {
    id: `task-${uuidv4().slice(0, 8)}`,
    title,
    description: description || '',
    status: status || 'todo',
    priority: priority || 'medium',
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  }
  
  project.tasks.push(newTask)
  writeTasksData(data)
  
  addActivity('task_created', 'Aufgabe erstellt', `"${title}" wurde zu ${project.name} hinzugefügt`, {
    projectId: project.id,
    projectName: project.name,
    taskId: newTask.id
  })
  
  res.json(newTask)
})

// Update task
app.put('/api/tasks/:taskId', (req, res) => {
  const data = readTasksData()
  
  for (const project of data.projects) {
    const taskIndex = project.tasks.findIndex(t => t.id === req.params.taskId)
    if (taskIndex !== -1) {
      project.tasks[taskIndex] = { ...project.tasks[taskIndex], ...req.body }
      writeTasksData(data)
      
      if (req.body.status) {
        addActivity('task_updated', 'Aufgabe verschoben', 
          `"${project.tasks[taskIndex].title}" → ${req.body.status}`, {
          projectId: project.id,
          projectName: project.name,
          taskId: req.params.taskId,
          newStatus: req.body.status
        })
      }
      
      return res.json(project.tasks[taskIndex])
    }
  }
  
  res.status(404).json({ error: 'Task not found' })
})

// Get activities
app.get('/api/activity', (req, res) => {
  const data = readActivityData()
  const limit = parseInt(req.query.limit) || 50
  
  res.json({
    activities: data.activities.slice(0, limit)
  })
})

// Add activity (POST endpoint for agents)
app.post('/api/activity', (req, res) => {
  const { projectId, message, type = 'system', title, description } = req.body
  
  if (!message && !title) {
    return res.status(400).json({ 
      error: 'Either message or title is required',
      success: false
    })
  }
  
  const data = readActivityData()
  const newActivity = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    type,
    status: 'completed',
    project: projectId || null
  }
  
  // Support both message (simple) and title+description (structured)
  if (message) {
    newActivity.message = message
  }
  if (title) {
    newActivity.title = title
  }
  if (description) {
    newActivity.description = description
  }
  
  data.activities.unshift(newActivity)
  writeActivityData(data)
  
  res.json({ success: true, activity: newActivity })
})

// Agent status
app.get('/api/agents/status', (req, res) => {
  const sessionDir = '/Users/jeff/.openclaw/agents'
  const agents = ['main', 'kbagent', 'orchestrator']
  
  const agentStatus = agents.map(agentId => {
    // Define agent metadata
    const metadata = {
      main: { name: 'Jeff', emoji: '🤖', model: 'Claude Sonnet 4.5' },
      kbagent: { name: 'KBAgent', emoji: '📚', model: 'Gemini 3 Pro High' },
      orchestrator: { name: 'Orchestrator', emoji: '🌀', model: 'Gemini 3 Flash' }
    }
    
    // Check session activity
    const sessionPath = path.join(sessionDir, agentId, 'sessions')
    let status = 'IDLE'
    
    try {
      if (fs.existsSync(sessionPath)) {
        const files = fs.readdirSync(sessionPath)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({
            name: f,
            path: path.join(sessionPath, f),
            mtime: fs.statSync(path.join(sessionPath, f)).mtime
          }))
          .sort((a, b) => b.mtime - a.mtime)
        
        if (files.length > 0) {
          const lastModified = files[0].mtime
          const ageMinutes = (Date.now() - lastModified.getTime()) / 1000 / 60
          
          // If last activity was less than 2 minutes ago, consider WORKING
          if (ageMinutes < 2) {
            status = 'WORKING'
          }
        }
      }
    } catch (error) {
      console.error(`Error checking agent ${agentId}:`, error)
    }
    
    return {
      id: agentId,
      ...metadata[agentId],
      status
    }
  })
  
  res.json({ agents: agentStatus })
})

app.get('/api/agent-status', (req, res) => {
  const data = readTasksData()
  let busyTasks = 0
  
  data.projects.forEach(project => {
    busyTasks += project.tasks.filter(t => t.status === 'in-progress').length
  })
  
  if (busyTasks > 0) {
    res.json({
      status: 'busy',
      text: `Beschäftigt (${busyTasks} Aufgabe${busyTasks !== 1 ? 'n' : ''})`
    })
  } else {
    res.json({
      status: 'available',
      text: 'Verfügbar'
    })
  }
})

// Discover agents
app.get('/api/agents', (req, res) => {
  const agentsDir = '/Users/jeff/.openclaw/agents';
  const mainWorkspace = '/Users/jeff/.openclaw/workspace';
  
  const agents = [
    {
      id: 'main',
      name: 'Jeff (Main)',
      emoji: '🤖',
      workspace: mainWorkspace
    }
  ];
  
  // Scan agents directory
  try {
    if (fs.existsSync(agentsDir)) {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const agentId = entry.name;
          const workspacePath = path.join(agentsDir, agentId, 'workspace');
          
          // Check if workspace exists
          if (fs.existsSync(workspacePath)) {
            // Try to read identity from agent config or use defaults
            let name = agentId.charAt(0).toUpperCase() + agentId.slice(1);
            let emoji = '🔧';
            
            // Check if SOUL.md or IDENTITY.md exists for metadata
            const soulPath = path.join(workspacePath, 'SOUL.md');
            if (fs.existsSync(soulPath)) {
              // Could parse emoji from SOUL.md if needed
              if (agentId === 'kbagent') emoji = '📚';
              if (agentId === 'orchestrator') emoji = '🌀';
            }
            
            agents.push({
              id: agentId,
              name: name,
              emoji: emoji,
              workspace: workspacePath
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error scanning agents:', error);
  }
  
  res.json({ agents });
});

// Context files
app.get('/api/context-files', (req, res) => {
  const agent = req.query.agent || 'main';
  
  // Determine workspace directory
  let workspaceDir;
  if (agent === 'main') {
    workspaceDir = '/Users/jeff/.openclaw/workspace';
  } else {
    workspaceDir = path.join('/Users/jeff/.openclaw/agents', agent, 'workspace');
  }
  
  const contextFiles = [
    { name: 'AGENTS.md', description: 'Agent Workspace Guidelines' },
    { name: 'SOUL.md', description: 'Persönlichkeit & Verhalten' },
    { name: 'USER.md', description: 'Nutzer-Informationen' },
    { name: 'MEMORY.md', description: 'Langzeit-Gedächtnis' },
    { name: 'TOOLS.md', description: 'Tool-Dokumentation' },
    { name: 'HEARTBEAT.md', description: 'Heartbeat Instructions' }
  ];
  
  const files = contextFiles.map(file => {
    const filePath = path.join(workspaceDir, file.name);
    try {
      const stats = fs.statSync(filePath);
      return {
        ...file,
        exists: true,
        size: stats.size
      };
    } catch (error) {
      return {
        ...file,
        exists: false,
        size: 0
      };
    }
  });
  
  res.json({ files, agent, workspaceDir });
});

// Get context file content
app.get('/api/context-files/:filename', (req, res) => {
  const agent = req.query.agent || 'main';
  
  let workspaceDir;
  if (agent === 'main') {
    workspaceDir = '/Users/jeff/.openclaw/workspace';
  } else {
    workspaceDir = path.join('/Users/jeff/.openclaw/agents', agent, 'workspace');
  }
  
  const filePath = path.join(workspaceDir, req.params.filename);
  
  // Security check
  if (path.relative(workspaceDir, filePath).includes('..')) {
    return res.status(403).send('Access denied');
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.type('text/plain').send(content);
  } catch (error) {
    res.status(404).send('File not found');
  }
});

// Update context file
app.put('/api/context-files/:filename', (req, res) => {
  const agent = req.query.agent || 'main';
  
  let workspaceDir;
  if (agent === 'main') {
    workspaceDir = '/Users/jeff/.openclaw/workspace';
  } else {
    workspaceDir = path.join('/Users/jeff/.openclaw/agents', agent, 'workspace');
  }
  
  const filePath = path.join(workspaceDir, req.params.filename);
  
  // Security check
  if (path.relative(workspaceDir, filePath).includes('..')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    fs.writeFileSync(filePath, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save file' });
  }
});

app.listen(PORT, () => {
  console.log(`🦞 Kanban API Server running on port ${PORT}`)
})