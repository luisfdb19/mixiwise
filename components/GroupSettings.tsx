'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { useOrganization } from '@clerk/nextjs';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getRecurringExpenses, toggleRecurringExpenseStatus, deleteRecurringExpense } from '@/app/actions';
import { formatCurrency } from '@/lib/currency';

interface RecurringExpense {
  id: string;
  group_id: string;
  amount: number;
  description: string;
  split_percentage: number;
  split_with: { id: string; name: string; splitAmount?: number }[];
  created_by: string;
  interval_unit: 'month' | 'year';
  next_occurrence: string;
  total_installments: number | null;
  current_installment: number;
  active: boolean;
  created_at: string;
  currency?: string;
}

export default function GroupSettings() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const router = useRouter();

  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);

  const fetchRecurring = useCallback(async () => {
    if (organization?.id) {
      const result = await getRecurringExpenses(organization.id);
      setRecurringExpenses(result);
    }
  }, [organization?.id]);

  useEffect(() => {
    if (organization) {
      setGroupName(organization.name);
      fetchRecurring();
    }
  }, [organization, fetchRecurring]);

  const handleSaveName = async () => {
    if (!organization || !groupName.trim() || groupName === organization.name) return;

    setSaving(true);
    try {
      await organization.update({ name: groupName });
      toast({ title: 'Success', description: 'Group name updated' });
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: (error as { errors?: { message: string }[] }).errors?.[0]?.message || 'Failed to update group name',
        variant: 'destructive',
      });
      setGroupName(organization.name); // revert on error
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!organization) return;
    
    setDeleting(true);
    try {
      await organization.destroy();
      toast({ title: 'Group deleted', description: 'The group has been permanently deleted.' });
      router.push('/groups');
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: (error as { errors?: { message: string }[] }).errors?.[0]?.message || 'Failed to delete group',
        variant: 'destructive',
      });
      setDeleting(false);
    }
  };

  if (!organization) return null;

  return (
    <div className="space-y-8">
      {/* Edit Group Name */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold mb-4">Group Name</h3>
          <div className="flex gap-3">
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="flex-grow"
              placeholder="Enter group name"
            />
            <Button 
              onClick={handleSaveName} 
              disabled={saving || groupName.trim() === '' || groupName === organization.name}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recurring Expenses Card */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Despesas Recorrentes e Parceladas</h3>
          {recurringExpenses.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {recurringExpenses.map((re) => {
                return (
                  <div key={re.id} className="py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-grow">
                      <h4 className="font-semibold text-sm text-gray-900 truncate">
                        {re.description}
                      </h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatCurrency(re.amount, re.currency || 'BRL')} / {re.interval_unit === 'year' ? 'ano' : 'mês'} 
                        {re.total_installments ? ` (Parcela ${re.current_installment - 1} de ${re.total_installments})` : ' (Recorrência contínua)'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-semibold">
                        Próxima cobrança: {new Date(re.next_occurrence).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={async () => {
                          const res = await toggleRecurringExpenseStatus(re.id, !re.active);
                          if (res.success) {
                            fetchRecurring();
                            toast({ title: re.active ? 'Pausado' : 'Ativado', description: 'Status da recorrência atualizado.' });
                          }
                        }}
                        className="transition-all"
                      >
                        {re.active ? (
                          <span className="text-[10px] text-green-700 font-bold bg-green-50 px-2 py-1 rounded border border-green-200 hover:bg-green-100 transition-colors">Ativa</span>
                        ) : (
                          <span className="text-[10px] text-gray-500 font-bold bg-gray-50 px-2 py-1 rounded border border-gray-200 hover:bg-gray-100 transition-colors">Pausada</span>
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                        onClick={async () => {
                          if (window.confirm('Tem certeza que deseja excluir esta recorrência? Nenhuma despesa futura será criada.')) {
                            const res = await deleteRecurringExpense(re.id);
                            if (res.success) {
                              fetchRecurring();
                              toast({ title: 'Excluído', description: 'Recorrência deletada com sucesso.' });
                            }
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-2 font-medium">Nenhuma recorrência ou parcelamento ativo no grupo.</p>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <h3 className="text-lg font-semibold text-red-600">Danger Zone</h3>
          </div>
          
          <div className="flex items-center justify-between mt-6">
            <div>
              <h4 className="font-semibold text-gray-900">Delete Group</h4>
              <p className="text-sm text-gray-500 max-w-md">
                Once you delete a group, there is no going back. All expenses data associated with this group will remain in the database but the group membership will be permanently deleted.
              </p>
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive">Delete Group</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="text-red-600">Delete Group</DialogTitle>
                  <DialogDescription>
                    This action is irreversible. To confirm deletion, please type the group name <strong className="select-none">{organization.name}</strong> below.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="py-4">
                  <Input 
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={organization.name}
                  />
                </div>

                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" onClick={() => setDeleteConfirmText('')}>Cancel</Button>
                  </DialogClose>
                  <Button 
                    variant="destructive" 
                    disabled={deleteConfirmText !== organization.name || deleting}
                    onClick={handleDeleteGroup}
                  >
                    {deleting ? 'Deleting...' : 'I understand, delete group'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
