'use client';
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Trash2, Paperclip, X, RefreshCw, Users, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useParams } from 'next/navigation';
import { useOrganization, useOrganizationList, useUser } from '@clerk/nextjs';
import { getGroupData, deleteExpense } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import GroupMembers from '@/components/GroupMembers';
import GroupSettings from '@/components/GroupSettings';
import SettleUpDialog from '@/components/SettleUpDialog';
import AddExpenseDialog from '@/components/AddExpenseDialog';
import RecurringExpenseDetailDialog from '@/components/RecurringExpenseDetailDialog';
import UserStatement from '@/components/UserStatement';
import { formatCurrency } from '@/lib/currency';

interface Balance {
  debtor: string;
  debtorId?: string;
  creditor: string;
  creditorId?: string;
  amount: number;
  currency?: string;
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  created_by: string;
  created_by_name?: string;
  split_with: {
    id: string;
    name: string;
    splitAmount: number;
  }[];
  created_at?: string;
  receipt_data?: string;
  receipt_type?: string;
  recurring_expense_id?: string;
  currency?: string;
}

const formatAmount = (amount: number | string) => {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return numAmount.toFixed(2);
};

export default function GroupPage() {
  const { id } = useParams();
  const { setActive } = useOrganizationList();
  const { organization, membership, isLoaded: orgLoaded } = useOrganization();
  const { user, isLoaded: userLoaded } = useUser();
  const router = useRouter();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgReady, setOrgReady] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<{data: string, type: string} | null>(null);
  const { toast } = useToast();

  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [recurringDetailExpense, setRecurringDetailExpense] = useState<Expense | null>(null);

  // Fetch organization members to pass to AddExpenseDialog
  useEffect(() => {
    async function fetchOrgMembers() {
      if (organization) {
        try {
          const memberships = await organization.getMemberships();
          const membersList = memberships.data.map((m) => ({
            id: m.publicUserData.userId ?? '',
            name: `${m.publicUserData.firstName ?? ''} ${
              m.publicUserData.lastName ?? ''
            }`.trim(),
          }));
          setMembers(membersList);
        } catch (err) {
          console.error('Error fetching memberships:', err);
        }
      }
    }
    if (orgLoaded && organization) {
      fetchOrgMembers();
    }
  }, [organization, orgLoaded]);

  useEffect(() => {
    if (setActive && id) {
      setActive({ organization: id as string }).then(() => {
        setOrgReady(true);
      }).catch((err) => {
        console.error('Error setting active organization:', err);
        setOrgReady(true);
      });
    }
  }, [setActive, id]);

  useEffect(() => {
    async function fetchData() {
      if (id && user) {
        const { expenses, balances } = await getGroupData(
          id as string,
          user.id,
          user.fullName || 'You'
        );
        setExpenses(expenses);
        setBalances(balances);
        setLoading(false);
      }
    }
    if (userLoaded && orgReady) {
      fetchData();
    }
  }, [id, user, userLoaded, orgReady]);

  if (!orgLoaded || !userLoaded || loading || !orgReady) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-xl text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!organization) {
    return <div>Organization not found</div>;
  }

  const isAdmin = membership?.role === 'org:admin';

  const getInitials = (name: string): string => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRandomColor = (idStr: string): string => {
    const colors = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500', 'bg-purple-500', 'bg-teal-500', 'bg-indigo-500'];
    let hash = 0;
    for (let i = 0; i < idStr.length; i++) hash += idStr.charCodeAt(i);
    return colors[hash % colors.length];
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (window.confirm('Are you sure you want to delete this?')) {
      const result = await deleteExpense(expenseId);
      if (result.success) {
        const { expenses: updatedExpenses, balances: updatedBalances } =
          await getGroupData(id as string, user?.id || '', user?.fullName || 'You');
        setExpenses(updatedExpenses);
        setBalances(updatedBalances);
        router.refresh();
      } else {
        toast({ title: 'Error', description: 'Failed to delete.' });
      }
    }
  };

  const normalizeStr = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const isMe = (nameOrId: string, userId?: string) => {
    if (!user) return false;
    if (userId && userId === user.id) return true;
    if (nameOrId === user.id) return true;
    
    const normalizedTarget = normalizeStr(nameOrId);
    if (user.fullName && normalizedTarget === normalizeStr(user.fullName)) return true;
    if (user.firstName && normalizedTarget.includes(normalizeStr(user.firstName))) return true;
    
    return false;
  };

  const shortName = (name: string, userId?: string) => {
    if (isMe(name, userId)) return 'você';
    const parts = name.split(' ');
    if (parts.length > 1) return `${parts[0]} ${parts[parts.length-1][0]}.`;
    return name;
  };

  return (
    <div className="px-4 sm:px-6 max-w-4xl mx-auto bg-gray-50 min-h-screen pb-20 sm:pb-6 pt-4 sm:pt-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-5 gap-4">
        <div className="flex items-center gap-3 flex-grow min-w-0">
          <div className="w-11 h-11 sm:w-14 sm:h-14 bg-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-lg sm:text-2xl shadow-md flex-shrink-0">
            {getInitials(organization.name)}
          </div>
          <div className="min-w-0 flex-grow flex flex-row items-center justify-between">
            <div className="min-w-0 pr-2">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate leading-tight">{organization.name}</h1>
              <p className="text-xs text-gray-500 mt-0.5">{(organization as unknown as { membersCount: number }).membersCount} membros</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button 
                variant="ghost" 
                size="icon" 
                className={`h-9 w-9 rounded-full ${activeTab === 'members' ? 'bg-gray-200 text-purple-600' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-900'}`} 
                onClick={() => setActiveTab('members')}
              >
                <Users size={18} />
              </Button>
              {isAdmin && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`h-9 w-9 rounded-full ${activeTab === 'settings' ? 'bg-gray-200 text-purple-600' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-900'}`} 
                  onClick={() => setActiveTab('settings')}
                >
                  <Settings size={18} />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto flex-shrink-0">
          <Button 
            className="bg-teal-500 hover:bg-teal-600 text-white shadow-sm font-semibold gap-1.5 text-xs sm:text-sm"
            onClick={() => setIsAddExpenseOpen(true)}
          >
            Adicionar despesa
          </Button>
          <SettleUpDialog balances={balances} groupId={id as string} />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 bg-white border shadow-sm flex h-auto p-1">
          <TabsTrigger value="overview" className="flex-1 text-xs sm:text-sm py-2">Visão Geral</TabsTrigger>
          <TabsTrigger value="statement" className="flex-1 text-xs sm:text-sm py-2">Extrato</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8">
          <div>
            <h2 className="text-xl font-bold mb-4 text-gray-800">Balances</h2>
            {balances.length > 0 ? (
              <div className="space-y-6">
                {Object.entries(
                  balances.reduce((acc, balance) => {
                    const curr = balance.currency || 'BRL';
                    if (!acc[curr]) acc[curr] = [];
                    acc[curr].push(balance);
                    return acc;
                  }, {} as Record<string, Balance[]>)
                ).map(([currency, currencyBalances]) => (
                  <div key={currency}>
                    {Object.keys(balances.reduce((acc, b) => ({...acc, [b.currency || 'BRL']: true}), {})).length > 1 && (
                      <h3 className="text-md font-semibold mb-3 text-gray-600">{currency}</h3>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {currencyBalances.map((balance, index) => {
                        const amIDebtor = isMe(balance.debtor, balance.debtorId);
                        const amICreditor = isMe(balance.creditor, balance.creditorId);
                        
                        let text = '';
                        let amountClass = 'text-gray-900';
                        
                        if (amIDebtor) {
                          text = `você deve a ${shortName(balance.creditor, balance.creditorId)}`;
                          amountClass = 'text-red-500';
                        } else if (amICreditor) {
                          text = `${shortName(balance.debtor, balance.debtorId)} deve a você`;
                          amountClass = 'text-green-500';
                        } else {
                          text = `${shortName(balance.debtor, balance.debtorId)} deve a ${shortName(balance.creditor, balance.creditorId)}`;
                        }

                        return (
                          <Card key={`${currency}-${index}`} className="shadow-sm border-0 ring-1 ring-gray-200 overflow-hidden">
                            <CardContent className="flex items-center p-3 sm:p-4">
                              <div className={`h-9 w-9 sm:h-12 sm:w-12 ${getRandomColor(balance.debtor)} rounded-full mr-3 sm:mr-4 flex items-center justify-center text-white font-bold text-xs sm:text-lg flex-shrink-0`}>
                                {getInitials(balance.debtor)}
                              </div>
                              <div className="min-w-0 flex-grow">
                                <p className="text-xs sm:text-sm text-gray-500 font-medium truncate">{text}</p>
                                <p className={`text-lg sm:text-xl font-bold ${amountClass}`}>
                                  {formatCurrency(balance.amount, currency)}
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">🌟 Tudo zerado! Ninguém deve nada. 🎉</p>
            )}
          </div>

          <div>
            <h2 className="text-xl font-bold mb-4 text-gray-800">Expenses</h2>
            {expenses.length > 0 ? (
              <div className="space-y-2">
                {expenses.map((expense) => {
                  const creatorIsMe = isMe(expense.created_by_name || expense.created_by, expense.created_by);
                  const creatorStr = shortName(expense.created_by_name || expense.created_by, expense.created_by);
                  const isPayment = expense.description.toLowerCase().includes('pagou') || expense.description.toLowerCase().includes('payment') || expense.description.toLowerCase().includes('pagamento');
                  
                  // For a payment, the layout is slightly different
                  let lentText = '';
                  let lentAmount = '';
                  let lentClass = 'text-gray-500';
                  
                  if (!isPayment && expense.split_with.length > 0) {
                    // Find the split member who isn't the creator (the actual borrower)
                    const creatorId = expense.created_by;
                    const otherMember = expense.split_with.find(m => {
                      if (creatorIsMe) return !isMe(m.name, m.id);
                      return isMe(m.name, m.id);
                    }) || expense.split_with.find(m => m.id !== creatorId) || expense.split_with[0];
                    
                    const otherIsMe = isMe(otherMember.name, otherMember.id);
                    
                    if (creatorIsMe) {
                      lentText = `você emprestou a ${shortName(otherMember.name, otherMember.id)}`;
                      lentAmount = formatCurrency(otherMember.splitAmount, expense.currency || 'BRL');
                      lentClass = 'text-green-500 font-medium';
                    } else if (otherIsMe) {
                      lentText = `${creatorStr} emprestou a você`;
                      lentAmount = formatCurrency(otherMember.splitAmount, expense.currency || 'BRL');
                      lentClass = 'text-red-500 font-medium';
                    } else {
                      lentText = `${creatorStr} emprestou a ${shortName(otherMember.name, otherMember.id)}`;
                      lentAmount = formatCurrency(otherMember.splitAmount, expense.currency || 'BRL');
                    }
                  } else if (isPayment) {
                    lentText = 'Pagamento';
                    lentAmount = formatCurrency(expense.amount, expense.currency || 'BRL');
                    lentClass = 'text-green-500 font-medium';
                  }

                  return (
                    <Card 
                      key={expense.id} 
                      className={`shadow-sm hover:bg-gray-100 transition-colors border-0 ring-1 ring-gray-200 cursor-pointer overflow-hidden ${expense.recurring_expense_id ? 'ring-purple-100' : ''}`}
                      onClick={() => {
                        if (expense.recurring_expense_id) {
                          setRecurringDetailExpense(expense);
                        } else {
                          setEditingExpense(expense);
                          setIsAddExpenseOpen(true);
                        }
                      }}
                    >
                      <CardContent className="flex items-center justify-between p-3 sm:p-4 h-[68px]">
                        <div className="flex items-center flex-grow min-w-0 overflow-hidden">
                          <div className="flex flex-col items-center justify-center mr-2.5 sm:mr-4 w-9 sm:w-12 flex-shrink-0 text-center">
                            <span className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wider leading-tight">
                              {expense.created_at ? new Date(expense.created_at).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') : 'Mês'}
                            </span>
                            <span className="text-base sm:text-xl font-bold text-gray-700 leading-tight">
                              {expense.created_at ? new Date(expense.created_at).getDate() : '--'}
                            </span>
                          </div>
                          
                          <div className="flex-grow min-w-0 overflow-hidden pr-1 sm:pr-4">
                            <h3 className="font-semibold text-gray-900 truncate text-xs sm:text-base leading-tight flex items-center gap-1">
                              {expense.recurring_expense_id && (
                                <RefreshCw size={11} className="text-purple-400 flex-shrink-0 sm:hidden" />
                              )}
                              {expense.recurring_expense_id && (
                                <RefreshCw size={13} className="text-purple-400 flex-shrink-0 hidden sm:inline" />
                              )}
                              {expense.description}
                            </h3>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1.5 mt-0.5 min-w-0 overflow-hidden">
                              <span className="truncate text-[10px] sm:text-xs text-gray-500 leading-tight block">
                                <span>{creatorIsMe ? 'você' : creatorStr} pagou </span>
                                <span className="font-semibold text-gray-800">{formatCurrency(expense.amount, expense.currency || 'BRL')}</span>
                              </span>
                              {lentText && (
                                <span className={`truncate text-[10px] sm:text-xs leading-tight block ${lentClass}`}>
                                  {lentText.replace(' emprestou a você', ' te emprestou').replace(' emprestou a ', ' emprestou ')} {lentAmount}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-0 sm:gap-1 flex-shrink-0">
                          {expense.receipt_data && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-gray-400 hover:text-teal-600 hover:bg-teal-50 flex-shrink-0 h-8 w-8 sm:h-10 sm:w-10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReceipt({ data: expense.receipt_data!, type: expense.receipt_type || 'image/jpeg' });
                              }}
                            >
                              <Paperclip size={15} className="sm:hidden" />
                              <Paperclip size={18} className="hidden sm:block" />
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-gray-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0 h-8 w-8 sm:h-10 sm:w-10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteExpense(expense.id);
                            }}
                          >
                            <Trash2 size={15} className="sm:hidden" />
                            <Trash2 size={18} className="hidden sm:block" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">💸 Nenhuma despesa ainda. Hora de rachar a conta! 🧾</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="members">
          <GroupMembers isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="statement">
          {user ? (
            <UserStatement expenses={expenses} currentUser={{ id: user.id, fullName: user.fullName, firstName: user.firstName }} />
          ) : (
            <div className="text-center py-8 text-gray-500">Carregando extrato...</div>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="settings">
            <GroupSettings />
          </TabsContent>
        )}
      </Tabs>

      <AddExpenseDialog
        isOpen={isAddExpenseOpen}
        onClose={() => {
          setIsAddExpenseOpen(false);
          setEditingExpense(null);
        }}
        groupId={id as string}
        members={members}
        currentUser={user ? { id: user.id, fullName: user.fullName, firstName: user.firstName } : null}
        expenseToEdit={editingExpense}
        onSuccess={async () => {
          if (id && user) {
            const { expenses: updatedExpenses, balances: updatedBalances } = await getGroupData(
              id as string,
              user.id,
              user.fullName || 'You'
            );
            setExpenses(updatedExpenses);
            setBalances(updatedBalances);
            router.refresh();
          }
        }}
      />

      {/* Recurring Expense Detail Dialog */}
      {recurringDetailExpense?.recurring_expense_id && (
        <RecurringExpenseDetailDialog
          isOpen={!!recurringDetailExpense}
          onClose={() => setRecurringDetailExpense(null)}
          recurringExpenseId={recurringDetailExpense.recurring_expense_id}
          expenseDescription={recurringDetailExpense.description}
          currentUserId={user?.id}
          onEditExpense={() => {
            setEditingExpense(recurringDetailExpense);
            setIsAddExpenseOpen(true);
            setRecurringDetailExpense(null);
          }}
          onDataChanged={async () => {
            if (id && user) {
              const { expenses: updatedExpenses, balances: updatedBalances } = await getGroupData(
                id as string,
                user.id,
                user.fullName || 'You'
              );
              setExpenses(updatedExpenses);
              setBalances(updatedBalances);
              router.refresh();
            }
          }}
        />
      )}

      {/* Receipt Viewer Dialog */}
      <Dialog open={!!selectedReceipt} onOpenChange={(open) => !open && setSelectedReceipt(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden border-0 rounded-xl shadow-2xl bg-white">
          <DialogHeader className="bg-gray-100 p-4 flex flex-row items-center justify-between space-y-0 border-b">
            <DialogTitle className="text-xl font-bold text-gray-800">Recibo</DialogTitle>
            <DialogClose asChild>
              <button className="text-gray-500 hover:text-gray-700 transition-colors">
                <X size={20} />
              </button>
            </DialogClose>
          </DialogHeader>
          <div className="p-4 flex items-center justify-center max-h-[80vh] overflow-y-auto bg-gray-50">
            {selectedReceipt?.type.includes('pdf') ? (
              <iframe
                src={selectedReceipt.data}
                className="w-full h-[70vh] border-0"
                title="Recibo PDF"
              />
            ) : (
              <img
                src={selectedReceipt?.data}
                alt="Recibo"
                className="max-w-full h-auto object-contain rounded-md"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
