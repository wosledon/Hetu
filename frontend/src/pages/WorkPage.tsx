import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import WorkSidebar from '../components/work/WorkSidebar'
import WorkSessionArea from '../components/work/WorkSessionArea'
import WorkExplorer from '../components/work/WorkExplorer'
import WorkTerminal from '../components/work/WorkTerminal'
import { workProjectService } from '../services/workService'
import type { IWorkProject, IWorkSession } from '../types/work'

export default function WorkPage() {
  const queryClient = useQueryClient()
  const [selectedProject, setSelectedProject] = useState<IWorkProject | null>(null)
  const [selectedSession, setSelectedSession] = useState<IWorkSession | null>(null)
  const [showTerminal, setShowTerminal] = useState(true)

  const { data: projects = [] } = useQuery({
    queryKey: ['workProjects'],
    queryFn: workProjectService.getAll,
  })

  // 默认选中第一个项目
  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0])
    }
  }, [projects, selectedProject])

  const handleSelectProject = (project: IWorkProject) => {
    setSelectedProject(project)
  }

  const handleSelectSession = (session: IWorkSession) => {
    setSelectedSession(session)
    queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
  }

  const handleSessionUpdated = (session: IWorkSession) => {
    setSelectedSession(session)
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex h-full min-w-0 flex-1">
          <WorkSidebar
            selectedProjectId={selectedProject?.id}
            selectedSessionId={selectedSession?.id}
            onSelectProject={handleSelectProject}
            onSelectSession={handleSelectSession}
          />
          <WorkSessionArea
            project={selectedProject ?? undefined}
            session={selectedSession ?? undefined}
            onSessionUpdated={handleSessionUpdated}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <WorkExplorer
                projectId={selectedProject?.id}
                sessionId={selectedSession?.id}
              />
            </div>
            {showTerminal && (
              <WorkTerminal projectId={selectedProject?.id} onClose={() => setShowTerminal(false)} />
            )}
          </div>
        </div>
      }
    />
  )
}
