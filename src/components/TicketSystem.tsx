import React, { useState } from 'react';
import { useTickets } from '../hooks/useTickets';
import { useAuth } from '../hooks/useAuth';
import type { Ticket, TicketType } from '../types/tickets';
import { TICKET_TYPE_LABELS } from '../types/tickets';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface TicketSystemProps {
  isOpen: boolean;
  onClose: () => void;
}

// Token-based color mapping for ticket types
const TICKET_TYPE_TOKEN_COLORS: Record<TicketType, string> = {
  bug: 'bg-destructive/15 border-destructive/30 text-destructive',
  feature: 'bg-info/15 border-info/30 text-info',
  improvement: 'bg-warning/15 border-warning/30 text-warning',
  question: 'bg-primary/15 border-primary/30 text-primary',
  // @ts-expect-error - task is referenced in spec but not in TicketType union; keep as fallback
  task: 'bg-success/15 border-success/30 text-success'
};

const TicketSystem: React.FC<TicketSystemProps> = ({ isOpen, onClose }) => {
  const {
    tickets,
    isLoading,
    createTicket,
    toggleTask,
    rejectTicket,
    deleteTicket,
    updateTicket,
    canDeleteTicket,
    canEditTicket,
    canCreateTickets,
    isDeveloper,
  } = useTickets();
  const { hasPermission } = useAuth();
  const { t } = useTranslation();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTicket, setNewTicket] = useState({
    title: '',
    type: 'bug' as TicketType,
    isAnonymous: false,
    tasks: ['']
  });
  const [rejectingTicket, setRejectingTicket] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [editingTicket, setEditingTicket] = useState<string | null>(null);
  const [editTicketData, setEditTicketData] = useState({
    title: '',
    type: 'bug' as TicketType,
    tasks: ['']
  });
  const [collapsedTickets, setCollapsedTickets] = useState<Set<string>>(new Set());
  const [showCompletedSection, setShowCompletedSection] = useState(false);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  if (!isOpen) return null;

  const handleAddTask = () => {
    setNewTicket(prev => ({
      ...prev,
      tasks: [...prev.tasks, '']
    }));
  };

  const handleUpdateTask = (index: number, value: string) => {
    setNewTicket(prev => ({
      ...prev,
      tasks: prev.tasks.map((task, i) => i === index ? value : task)
    }));
  };

  const handleRemoveTask = (index: number) => {
    setNewTicket(prev => ({
      ...prev,
      tasks: prev.tasks.filter((_, i) => i !== index)
    }));
  };

  const handleSubmitTicket = async () => {
    if (!newTicket.title.trim()) return;

    const validTasks = newTicket.tasks.filter(task => task.trim());
    if (validTasks.length === 0) return;

    const success = await createTicket(
      newTicket.title,
      newTicket.type,
      validTasks,
      newTicket.isAnonymous
    );

    if (success) {
      setNewTicket({ title: '', type: 'bug', isAnonymous: false, tasks: [''] });
      setShowCreateForm(false);
    }
  };

  const handleRejectTicket = async (ticketId: string) => {
    if (!rejectionReason.trim()) return;

    const success = await rejectTicket(ticketId, rejectionReason);
    if (success) {
      setRejectingTicket(null);
      setRejectionReason('');
    }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    if (window.confirm(t('actions.delete') + ' ?')) {
      await deleteTicket(ticketId);
    }
  };

  const handleStartEdit = (ticket: Ticket) => {
    setEditingTicket(ticket.id);
    setEditTicketData({
      title: ticket.title,
      type: ticket.type,
      tasks: ticket.tasks.map(t => t.text)
    });
  };

  const handleCancelEdit = () => {
    setEditingTicket(null);
    setEditTicketData({ title: '', type: 'bug', tasks: [''] });
  };

  const handleUpdateTicket = async (ticketId: string) => {
    const tasks = editTicketData.tasks.filter(t => t.trim());
    if (!editTicketData.title.trim() || tasks.length === 0) {
      return;
    }

    const success = await updateTicket(ticketId, {
      title: editTicketData.title.trim(),
      type: editTicketData.type,
      tasks
    });

    if (success) {
      setEditingTicket(null);
      setEditTicketData({ title: '', type: 'bug', tasks: [''] });
    }
  };

  const toggleCollapse = (ticketId: string) => {
    setCollapsedTickets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ticketId)) {
        newSet.delete(ticketId);
      } else {
        newSet.add(ticketId);
      }
      return newSet;
    });
  };

  // Edit form task handlers
  const handleAddEditTask = () => {
    setEditTicketData(prev => ({
      ...prev,
      tasks: [...prev.tasks, '']
    }));
  };

  const handleUpdateEditTask = (index: number, value: string) => {
    setEditTicketData(prev => ({
      ...prev,
      tasks: prev.tasks.map((task, i) => i === index ? value : task)
    }));
  };

  const handleRemoveEditTask = (index: number) => {
    setEditTicketData(prev => ({
      ...prev,
      tasks: prev.tasks.filter((_, i) => i !== index)
    }));
  };

  const getProgress = (ticket: Ticket) => {
    if (ticket.tasks.length === 0) return 0;
    const completed = ticket.tasks.filter(t => t.completed).length;
    return (completed / ticket.tasks.length) * 100;
  };

  const getTicketColors = (type: TicketType) => {
    return TICKET_TYPE_TOKEN_COLORS[type] || TICKET_TYPE_TOKEN_COLORS.bug;
  };

  // Split tickets into active and completed
  const activeTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress');
  const completedTickets = tickets.filter(t => t.status === 'completed' || t.status === 'rejected');

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-50">
      <div className="bg-card text-foreground rounded w-full max-w-4xl max-h-[92vh] sm:max-h-[90vh] flex flex-col border border-border mx-2 sm:mx-4 overflow-hidden shadow-theme-lg">
        {/* Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border bg-section-header text-section-header-foreground flex items-center justify-between">
          <div className="flex items-center">
            <i className="fas fa-ticket-alt text-section-header-foreground mr-2"></i>
            <h2 className="text-lg sm:text-xl font-semibold text-section-header-foreground">{t('tickets.title')}</h2>
            <span className="ml-2 px-2 py-0.5 bg-section-header-foreground/15 text-section-header-foreground text-[10px] sm:text-xs rounded border border-section-header-foreground/30">
              {tickets.length} {t('tickets.countLabel')}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {canCreateTickets && hasPermission('tickets.manage') && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-2 py-1.5 bg-primary text-primary-foreground rounded border border-border hover:brightness-95 text-xs sm:text-sm font-medium"
              >
                <i className="fas fa-plus mr-1 sm:mr-2"></i><span className="hidden sm:inline">{t('tickets.newTicket')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-section-header-foreground/80 hover:text-destructive"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {showCreateForm && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 border border-border rounded bg-background">
              <h3 className="text-base sm:text-lg font-medium mb-3 sm:mb-4 text-foreground">{t('tickets.createNewTicket')}</h3>

              {/* Title */}
              <div className="mb-3 sm:mb-4">
                <label className="block text-sm font-medium text-foreground mb-2">{t('tickets.fields.title')}</label>
                <input
                  type="text"
                  value={newTicket.title}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-border rounded bg-card text-foreground text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder={t('tickets.fields.taskPlaceholder') as string}
                />
              </div>

              {/* Type */}
              <div className="mb-3 sm:mb-4">
                <label className="block text-sm font-medium text-foreground mb-2">{t('tickets.fields.type')}</label>
                <select
                  value={newTicket.type}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, type: e.target.value as TicketType }))}
                  className="w-full px-3 py-1.5 border border-border rounded bg-card text-foreground text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                >
                  {Object.entries(TICKET_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Tasks */}
              <div className="mb-3 sm:mb-4">
                <label className="block text-sm font-medium text-foreground mb-2">{t('tickets.fields.tasks')}</label>
                {newTicket.tasks.map((task, index) => (
                  <div key={index} className="flex items-center mb-2">
                    <input
                      type="text"
                      value={task}
                      onChange={(e) => handleUpdateTask(index, e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddTask()}
                      className="flex-1 px-3 py-1.5 border border-border rounded bg-card text-foreground text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                      placeholder={t('tickets.fields.taskPlaceholder') as string}
                    />
                    {newTicket.tasks.length > 1 && (
                      <button
                        onClick={() => handleRemoveTask(index)}
                        className="ml-2 text-destructive hover:brightness-90"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={handleAddTask} className="text-primary hover:brightness-90 text-xs sm:text-sm">
                  <i className="fas fa-plus mr-1"></i>{t('tickets.buttons.addTask')}
                </button>
              </div>

              {/* Anonymous */}
              <div className="mb-3 sm:mb-4">
                <label className="flex items-center text-foreground">
                  <input
                    type="checkbox"
                    checked={newTicket.isAnonymous}
                    onChange={(e) => setNewTicket(prev => ({ ...prev, isAnonymous: e.target.checked }))}
                    className="mr-2 text-primary border-border focus:ring-primary"
                  />
                  <span className="text-sm text-foreground">{t('tickets.fields.anonymous')}</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex space-x-2">
                <button
                  onClick={handleSubmitTicket}
                  disabled={isLoading || !newTicket.title.trim()}
                  className="px-2 py-1.5 bg-success text-success-foreground rounded border border-border hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isLoading ? t('tickets.buttons.creating') : t('tickets.buttons.create')}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-2 py-1.5 bg-muted text-muted-foreground rounded border border-border hover:brightness-95 text-sm"
                >
                  {t('tickets.buttons.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Active Tickets */}
          <div className="space-y-4">
          {activeTickets.length === 0 && completedTickets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <i className="fas fa-ticket-alt text-4xl mb-4 text-muted-foreground"></i>
                <p>{t('tickets.empty')}</p>
              </div>
            ) : (
              <>
                {/* Active Tickets Section */}
                {activeTickets.length > 0 && (
                  <div>
                    <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2 sm:mb-3">
                      {t('tickets.activeTickets')} ({activeTickets.length})
                    </h3>
                    <div className="space-y-3 sm:space-y-4">
                      {activeTickets.map((ticket) => (
                        <TicketCard
                          key={ticket.id}
                          ticket={ticket}
                          isDeveloper={isDeveloper}
                          canDelete={canDeleteTicket(ticket)}
                          canEdit={canEditTicket(ticket)}
                          isEditing={editingTicket === ticket.id}
                          editData={editTicketData}
                          isCollapsed={false}
                          onEdit={handleStartEdit}
                          onCancelEdit={handleCancelEdit}
                          onUpdateTicket={handleUpdateTicket}
                          onDelete={handleDeleteTicket}
                          onReject={setRejectingTicket}
                          onToggleTask={toggleTask}
                          onToggleCollapse={toggleCollapse}
                          onEditDataChange={setEditTicketData}
                          onAddEditTask={handleAddEditTask}
                          onUpdateEditTask={handleUpdateEditTask}
                          onRemoveEditTask={handleRemoveEditTask}
                          getProgress={getProgress}
                          getTicketColors={getTicketColors}
                          rejectingTicket={rejectingTicket}
                          rejectionReason={rejectionReason}
                          setRejectionReason={setRejectionReason}
                          handleRejectTicket={handleRejectTicket}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed Tickets Section */}
                {completedTickets.length > 0 && (
                  <div className="mt-4 sm:mt-6">
                    <button
                      onClick={() => setShowCompletedSection(!showCompletedSection)}
                      className="flex items-center text-base sm:text-lg font-semibold text-foreground hover:text-foreground mb-2 sm:mb-3 p-1.5 sm:p-2 rounded hover:bg-muted transition-colors"
                    >
                      <i className={`fas fa-chevron-${showCompletedSection ? 'down' : 'right'} mr-2 text-muted-foreground`}></i>
                      {t('tickets.completedTickets')} ({completedTickets.length})
                    </button>

                    {showCompletedSection && (
                      <div className="space-y-3 sm:space-y-4">
                        {completedTickets.map((ticket) => (
                          <TicketCard
                            key={ticket.id}
                            ticket={ticket}
                            isDeveloper={isDeveloper}
                            canDelete={canDeleteTicket(ticket)}
                            canEdit={canEditTicket(ticket)}
                            isEditing={false}
                            editData={editTicketData}
                            isCollapsed={collapsedTickets.has(ticket.id)}
                            onEdit={handleStartEdit}
                            onCancelEdit={handleCancelEdit}
                            onUpdateTicket={handleUpdateTicket}
                            onDelete={handleDeleteTicket}
                            onReject={setRejectingTicket}
                            onToggleTask={toggleTask}
                            onToggleCollapse={toggleCollapse}
                            onEditDataChange={setEditTicketData}
                            onAddEditTask={handleAddEditTask}
                            onUpdateEditTask={handleUpdateEditTask}
                            onRemoveEditTask={handleRemoveEditTask}
                            getProgress={getProgress}
                            getTicketColors={getTicketColors}
                            rejectingTicket={rejectingTicket}
                            rejectionReason={rejectionReason}
                            setRejectionReason={setRejectionReason}
                            handleRejectTicket={handleRejectTicket}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Separate TicketCard component to reduce complexity
interface TicketCardProps {
  ticket: Ticket;
  isDeveloper: boolean;
  canDelete: boolean;
  canEdit: boolean;
  isEditing: boolean;
  editData: any;
  isCollapsed: boolean;
  onEdit: (ticket: Ticket) => void;
  onCancelEdit: () => void;
  onUpdateTicket: (ticketId: string) => void;
  onDelete: (ticketId: string) => void;
  onReject: (ticketId: string | null) => void;
  onToggleTask: (ticketId: string, taskId: string, completed: boolean) => void;
  onToggleCollapse: (ticketId: string) => void;
  onEditDataChange: (data: any) => void;
  onAddEditTask: () => void;
  onUpdateEditTask: (index: number, value: string) => void;
  onRemoveEditTask: (index: number) => void;
  getProgress: (ticket: Ticket) => number;
  getTicketColors: (type: TicketType) => string;
  rejectingTicket: string | null;
  rejectionReason: string;
  setRejectionReason: (reason: string) => void;
  handleRejectTicket: (ticketId: string) => void;
}

const TicketCard: React.FC<TicketCardProps> = ({
  ticket,
  isDeveloper,
  canDelete,
  canEdit,
  isEditing,
  editData,
  isCollapsed,
  onEdit,
  onCancelEdit,
  onUpdateTicket,
  onDelete,
  onReject,
  onToggleTask,
  onToggleCollapse,
  onEditDataChange,
  onAddEditTask,
  onUpdateEditTask,
  onRemoveEditTask,
  getProgress,
  getTicketColors,
  rejectingTicket,
  rejectionReason,
  setRejectionReason,
  handleRejectTicket
}) => {
  const progress = getProgress(ticket);
  const colors = getTicketColors(ticket.type);
  const isCompleted = ticket.status === 'completed' || ticket.status === 'rejected';
  const { t } = useTranslation();

  return (
    <div
      className={`border rounded p-3 sm:p-4 ${colors} ${
        ticket.status === 'completed' ? 'border-success' : ''
      } ${ticket.status === 'rejected' ? 'border-destructive' : ''}`}
    >
      {/* Ticket Header */}
      <div className="flex items-start justify-between mb-2 sm:mb-3">
        <div className="flex-1">
          {isEditing ? (
            // Edit Form
            <div className="space-y-2 sm:space-y-3">
              <input
                type="text"
                value={editData.title}
                onChange={(e) => onEditDataChange({ ...editData, title: e.target.value })}
                className="w-full px-3 py-1.5 border border-border rounded bg-card text-foreground text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                placeholder={t('tickets.fields.title') as string}
              />
              <select
                value={editData.type}
                onChange={(e) => onEditDataChange({ ...editData, type: e.target.value as TicketType })}
                className="px-3 py-1.5 border border-border rounded bg-card text-foreground text-sm focus:ring-1 focus:ring-primary focus:border-primary"
              >
                {Object.entries(TICKET_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="flex items-center mb-2">
                {isCompleted && (
                  <button
                    onClick={() => onToggleCollapse(ticket.id)}
                    className="mr-2 text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                  >
                    <i className={`fas fa-chevron-${isCollapsed ? 'right' : 'down'}`}></i>
                  </button>
                )}
                <span className="font-semibold text-base sm:text-lg">{ticket.title}</span>
                {ticket.status === 'completed' && (
                  <i className="fas fa-check-circle text-success ml-2"></i>
                )}
                {ticket.status === 'rejected' && (
                  <i className="fas fa-times-circle text-destructive ml-2"></i>
                )}
                {ticket.isAnonymous && (
                  <span className="ml-2 px-2 py-1 bg-muted text-muted-foreground text-xs rounded">{t('tickets.anonymous')}</span>
                )}
              </div>
              <div className="flex items-center text-xs sm:text-sm opacity-75">
                <span className="mr-4">{TICKET_TYPE_LABELS[ticket.type]}</span>
                <span className="mr-4">
                  {t('tickets.by')} {ticket.isAnonymous && !isDeveloper ? t('tickets.anonymous') : ticket.authorDisplayName}
                </span>
                <span>{new Date(ticket.createdAt?.toDate()).toLocaleDateString()}</span>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 ml-3 sm:ml-4">
          {isEditing ? (
            <>
              <button
                onClick={() => onUpdateTicket(ticket.id)}
                className="px-2 py-1 bg-success text-success-foreground rounded border border-border hover:brightness-95 text-xs sm:text-sm"
              >
                {t('tickets.buttons.save')}
              </button>
              <button
                onClick={onCancelEdit}
                className="px-2 py-1 bg-muted text-muted-foreground rounded border border-border hover:brightness-95 text-xs sm:text-sm"
              >
                {t('tickets.buttons.cancel')}
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button
                  onClick={() => onEdit(ticket)}
                  className="text-primary hover:brightness-90 p-1 rounded"
                  title={t('actions.edit') as string}
                >
                  <i className="fas fa-edit"></i>
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => onDelete(ticket.id)}
                  className="text-destructive hover:brightness-90 p-1 rounded"
                  title={t('actions.delete') as string}
                >
                  <i className="fas fa-trash"></i>
                </button>
              )}
              {isDeveloper && ticket.status !== 'completed' && ticket.status !== 'rejected' && (
                <button
                  onClick={() => onReject(ticket.id)}
                  className="text-warning hover:brightness-90 p-1 rounded"
                  title={t('tickets.buttons.reject') as string}
                >
                  <i className="fas fa-times"></i>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          {isEditing ? (
            /* Edit Tasks */
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-2">{t('tickets.fields.tasks')}</label>
              <div className="space-y-1.5 sm:space-y-2">
                {editData.tasks.map((task: string, index: number) => (
                  <div key={index} className="flex items-center">
                    <input
                      type="text"
                      value={task}
                      onChange={(e) => onUpdateEditTask(index, e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && onAddEditTask()}
                      className="flex-1 px-3 py-1.5 border border-border rounded bg-card text-foreground text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                      placeholder={t('tickets.fields.taskPlaceholder') as string}
                    />
                    {editData.tasks.length > 1 && (
                      <button
                        onClick={() => onRemoveEditTask(index)}
                        className="ml-2 text-destructive hover:brightness-90 p-1 rounded hover:bg-destructive/10"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={onAddEditTask}
                  className="text-primary hover:brightness-90 text-xs sm:text-sm px-2 py-1 rounded hover:bg-primary/10"
                >
                  <i className="fas fa-plus mr-1"></i>{t('tickets.buttons.addTask')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Progress Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>{t('tickets.progress')}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5 sm:h-2">
                  <div
                    className={`h-1.5 sm:h-2 rounded-full ${
                      progress === 100 ? 'bg-success' : 'bg-primary'
                    }`}
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>

              {/* Tasks */}
              <div className="space-y-1.5 sm:space-y-2">
                {ticket.tasks.map((task) => (
                  <div key={task.id} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={(e) => onToggleTask(ticket.id, task.id, e.target.checked)}
                      disabled={!isDeveloper || ticket.status === 'completed' || ticket.status === 'rejected'}
                      className="mr-2 sm:mr-3"
                    />
                    <span className={`text-sm ${task.completed ? 'line-through opacity-60' : ''}`}>
                      {task.text}
                    </span>
                  </div>
                ))}
              </div>

              {/* Rejection Info */}
              {ticket.status === 'rejected' && (
                <div className="mt-3 p-2.5 sm:p-3 bg-destructive/10 border-l-2 border-destructive rounded text-sm">
                  <div className="text-destructive font-medium">
                    <i className="fas fa-exclamation-triangle mr-2"></i>
                    <strong>{t('tickets.rejected')}</strong> {ticket.rejectionReason}
                  </div>
                </div>
              )}

              {/* Reject Modal */}
              {rejectingTicket === ticket.id && (
                <div className="mt-3 p-3 sm:p-4 bg-destructive/10 border border-destructive/30 rounded">
                  <label className="block text-sm font-medium text-destructive mb-2">
                    {t('tickets.fields.reasonRejection')}
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder={t('tickets.fields.rejectionPlaceholder') as string}
                    className="w-full px-3 py-1.5 border border-destructive/40 rounded bg-card text-foreground mb-3 focus:ring-1 focus:ring-destructive focus:border-destructive text-sm"
                    rows={3}
                  />
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleRejectTicket(ticket.id)}
                      disabled={!rejectionReason.trim()}
                      className="px-2 py-1 bg-destructive text-destructive-foreground rounded border border-border hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm"
                    >
                      {t('tickets.buttons.reject')}
                    </button>
                    <button
                      onClick={() => onReject(null)}
                      className="px-2 py-1 bg-muted text-muted-foreground rounded border border-border hover:brightness-95 text-xs sm:text-sm"
                    >
                      {t('tickets.buttons.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
export default TicketSystem;
