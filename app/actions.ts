'use server';

import { neon } from '@neondatabase/serverless';
import { clerkClient } from '@clerk/nextjs/server';

const sql = neon(process.env.DATABASE_URL!);

interface SplitMember {
  id: string;
  name: string;
  splitAmount?: number;
}

interface NicknameRow {
  user_id: string;
  nickname: string;
}

interface ExpenseData {
  amount: number;
  description: string;
  groupId: string;
  splitPercentage: number;
  splitWith: SplitMember[];
  createdBy: string;
  createdAt?: string;
  receiptData?: string;
  receiptType?: string;
  recurringExpenseId?: string;
  currency?: string;
}

interface Balance {
  debtor: string;
  debtorId?: string;
  creditor: string;
  creditorId?: string;
  amount: number;
  currency: string;
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
  split_percentage?: number;
  receipt_data?: string;
  receipt_type?: string;
  recurring_expense_id?: string;
  currency: string;
}

export async function addExpense(expenseData: ExpenseData) {
  const {
    amount,
    description,
    groupId,
    splitPercentage,
    splitWith,
    createdBy,
    createdAt,
    receiptData,
    receiptType,
    recurringExpenseId,
    currency = 'BRL',
  } = expenseData;

  try {
    // Create a JSON object with member information and split amounts
    const splitWithInfo = splitWith.map((member) => ({
      id: member.id,
      name: member.name,
      splitAmount: member.splitAmount !== undefined ? member.splitAmount : (amount * (splitPercentage / 100)) / splitWith.length,
    }));

    // Insert the expense with optional date and receipts
    const dateValue = createdAt ? new Date(createdAt) : new Date();
    await sql`
      INSERT INTO expenses (
        amount, description, group_id, split_percentage, created_by, split_with, created_at, receipt_data, receipt_type, recurring_expense_id, currency
      )
      VALUES (
        ${amount}, ${description}, ${groupId}, ${splitPercentage}, ${createdBy}, ${JSON.stringify(
      splitWithInfo
    )}, ${dateValue}, ${receiptData || null}, ${receiptType || null}, ${recurringExpenseId || null}, ${currency}
      )
    `;

    return { success: true };
  } catch (error) {
    console.error('Error adding expense:', error);
    return { success: false };
  }
}

export async function getGroupData(groupId: string, currentUserId: string, currentUserName: string) {
  try {
    // Process any recurring/installment expenses that are due
    await processRecurringExpenses(groupId);

    const expenses = (await sql`
      SELECT id, amount, description, created_by, split_with, created_at, split_percentage, receipt_data, receipt_type, recurring_expense_id, currency
      FROM expenses
      WHERE group_id = ${groupId}
      ORDER BY created_at DESC
    `) as Expense[];

    const balances: Balance[] = [];
    const balanceMapsByCurrency = new Map<string, Map<string, { amount: number; name: string }>>();

    // Fetch all nicknames
    const nicknamesResult = (await sql`SELECT user_id, nickname FROM nicknames`) as NicknameRow[];
    const nicknameMap = new Map<string, string>();
    nicknamesResult.forEach((n) => {
      nicknameMap.set(n.user_id, n.nickname);
    });

    // Build user mapping from all split members to map user IDs to names
    const userMap = new Map<string, string>();
    const canonicalIdMap = new Map<string, string>();
    if (currentUserId && currentUserName) {
      userMap.set(currentUserId, nicknameMap.get(currentUserId) || currentUserName);
      canonicalIdMap.set(currentUserId, currentUserId);
    }

    // Fetch actual organization members from Clerk to map names, emails, and slugs to nicknames
    try {
      const client = await clerkClient();
      const memberships = await client.organizations.getOrganizationMembershipList({
        organizationId: groupId,
      });
      memberships.data.forEach((m) => {
        const name = `${m.publicUserData?.firstName || ''} ${m.publicUserData?.lastName || ''}`.trim();
        const userId = m.publicUserData?.userId;
        const email = m.publicUserData?.identifier;
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const lowerName = name.toLowerCase();

        const resolvedName = nicknameMap.get(userId || '') || nicknameMap.get(email || '') || nicknameMap.get(slug) || name;

        if (userId) {
          userMap.set(userId, resolvedName);
          canonicalIdMap.set(userId, userId);
        }
        if (email) {
          userMap.set(email.toLowerCase(), resolvedName);
          if (userId) canonicalIdMap.set(email.toLowerCase(), userId);
        }
        if (slug) {
          userMap.set(slug, resolvedName);
          if (userId) canonicalIdMap.set(slug, userId);
        }
        if (lowerName) {
          userMap.set(lowerName, resolvedName);
          if (userId) canonicalIdMap.set(lowerName, userId);
        }
      });
    } catch (err) {
      console.error('Error fetching org members from Clerk:', err);
    }

    expenses.forEach((expense) => {
      expense.split_with.forEach((member) => {
        if (member.id) {
          userMap.set(member.id, nicknameMap.get(member.id) || member.name);
        }
      });
      // Also map creator
      if (expense.created_by) {
        userMap.set(expense.created_by, nicknameMap.get(expense.created_by) || userMap.get(expense.created_by) || 'Unknown');
      }
    });

    expenses.forEach((expense) => {
      // Map creator name
      expense.created_by_name = userMap.get(expense.created_by) || expense.created_by;
      
      // Update split member names in place
      expense.split_with.forEach((member) => {
        member.name = userMap.get(member.id) || userMap.get(member.name) || member.name;
      });

      const creatorSplit = expense.split_with.reduce(
        (sum: number, member: { splitAmount: number }) =>
          sum + member.splitAmount,
        0
      );

      const creatorId = canonicalIdMap.get(expense.created_by) || expense.created_by;
      const creatorName = userMap.get(creatorId) || 'Unknown';

      const currency = expense.currency || 'BRL';
      if (!balanceMapsByCurrency.has(currency)) {
        balanceMapsByCurrency.set(currency, new Map<string, { amount: number; name: string }>());
      }
      const balanceMap = balanceMapsByCurrency.get(currency)!;

      // Update creator's balance
      const creatorBalance = balanceMap.get(creatorId) || {
        amount: 0,
        name: creatorName,
      };
      creatorBalance.amount += creatorSplit;
      balanceMap.set(creatorId, creatorBalance);

      // Update split members' balances
      expense.split_with.forEach(
        (member: { id: string; name: string; splitAmount: number }) => {
          const canonicalMemberId = canonicalIdMap.get(member.id) || member.id;
          const memberBalance = balanceMap.get(canonicalMemberId) || {
            amount: 0,
            name: member.name,
          };
          memberBalance.amount -= member.splitAmount;
          balanceMap.set(canonicalMemberId, memberBalance);
        }
      );
    });

    balanceMapsByCurrency.forEach((balanceMap, currency) => {
      const debtors: { id: string; name: string; amount: number }[] = [];
      const creditors: { id: string; name: string; amount: number }[] = [];

      balanceMap.forEach(({ amount, name }, id) => {
        if (amount < -0.01) debtors.push({ id, name, amount: Math.abs(amount) });
        if (amount > 0.01) creditors.push({ id, name, amount });
      });

      debtors.sort((a, b) => b.amount - a.amount);
      creditors.sort((a, b) => b.amount - a.amount);

      let d = 0;
      let c = 0;

      while (d < debtors.length && c < creditors.length) {
        const debtor = debtors[d];
        const creditor = creditors[c];
        
        const settledAmount = Math.min(debtor.amount, creditor.amount);
        
        balances.push({
          debtor: debtor.name,
          debtorId: debtor.id,
          creditor: creditor.name,
          creditorId: creditor.id,
          amount: settledAmount,
          currency
        });
        
        debtor.amount -= settledAmount;
        creditor.amount -= settledAmount;
        
        if (debtor.amount < 0.01) d++;
        if (creditor.amount < 0.01) c++;
      }
    });

    return { expenses, balances };
  } catch (error) {
    console.error('Error fetching group data:', error);
    return { expenses: [], balances: [] };
  }
}

export async function deleteExpense(expenseId: string) {
  try {
    await sql`
      DELETE FROM expenses
      WHERE id = ${expenseId}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error deleting expense:', error);
    return { success: false };
  }
}

export async function updateExpense(expenseId: string, expenseData: {
  amount: number;
  description: string;
  splitPercentage: number;
  splitWith: SplitMember[];
  createdBy?: string;
  createdAt?: string;
  currency?: string;
}) {
  const { amount, description, splitPercentage, splitWith, createdBy, createdAt, currency } = expenseData;

  try {
    const splitWithInfo = splitWith.map((member) => ({
      id: member.id,
      name: member.name,
      splitAmount: member.splitAmount !== undefined ? member.splitAmount : (amount * (splitPercentage / 100)) / splitWith.length,
    }));

    const dateValue = createdAt ? new Date(createdAt) : null;

    if (createdBy && dateValue) {
      if (currency) {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)},
              created_by = ${createdBy},
              created_at = ${dateValue},
              currency = ${currency}
          WHERE id = ${expenseId}
        `;
      } else {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)},
              created_by = ${createdBy},
              created_at = ${dateValue}
          WHERE id = ${expenseId}
        `;
      }
    } else if (createdBy) {
      if (currency) {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)},
              created_by = ${createdBy},
              currency = ${currency}
          WHERE id = ${expenseId}
        `;
      } else {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)},
              created_by = ${createdBy}
          WHERE id = ${expenseId}
        `;
      }
    } else if (dateValue) {
      if (currency) {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)},
              created_at = ${dateValue},
              currency = ${currency}
          WHERE id = ${expenseId}
        `;
      } else {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)},
              created_at = ${dateValue}
          WHERE id = ${expenseId}
        `;
      }
    } else {
      if (currency) {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)},
              currency = ${currency}
          WHERE id = ${expenseId}
        `;
      } else {
        await sql`
          UPDATE expenses
          SET amount = ${amount},
              description = ${description},
              split_percentage = ${splitPercentage},
              split_with = ${JSON.stringify(splitWithInfo)}
          WHERE id = ${expenseId}
        `;
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating expense:', error);
    return { success: false };
  }
}

interface ImportedExpense {
  amount: number;
  description: string;
  groupId: string;
  splitPercentage: number;
  splitWith: { id: string; name: string; splitAmount: number }[];
  createdBy: string;
  date: string;
  currency?: string;
}

export async function importExpenses(expenses: ImportedExpense[]) {
  try {
    let importedCount = 0;
    for (const expense of expenses) {
      await sql`
        INSERT INTO expenses (
          amount, description, group_id, split_percentage, created_by, split_with, created_at, currency
        )
        VALUES (
          ${expense.amount}, ${expense.description}, ${expense.groupId},
          ${expense.splitPercentage}, ${expense.createdBy},
          ${JSON.stringify(expense.splitWith)}, ${expense.date}, ${expense.currency || 'BRL'}
        )
      `;
      importedCount++;
    }
    return { success: true, count: importedCount };
  } catch (error) {
    console.error('Error importing expenses:', error);
    return { success: false, count: 0 };
  }
}

export async function saveNickname(userId: string, nickname: string, alternativeKeys: string[] = []) {
  try {
    await sql`
      INSERT INTO nicknames (user_id, nickname)
      VALUES (${userId}, ${nickname})
      ON CONFLICT (user_id)
      DO UPDATE SET nickname = ${nickname}
    `;
    for (const key of alternativeKeys) {
      if (key) {
        await sql`
          INSERT INTO nicknames (user_id, nickname)
          VALUES (${key}, ${nickname})
          ON CONFLICT (user_id)
          DO UPDATE SET nickname = ${nickname}
        `;
      }
    }
    return { success: true };
  } catch (error) {
    console.error('Error saving nickname:', error);
    return { success: false };
  }
}

export async function getNicknames() {
  try {
    const result = (await sql`SELECT user_id, nickname FROM nicknames`) as NicknameRow[];
    const map: { [key: string]: string } = {};
    result.forEach((row) => {
      map[row.user_id] = row.nickname;
    });
    return map;
  } catch (error) {
    console.error('Error fetching nicknames:', error);
    return {};
  }
}

export async function createRecurringExpense(data: {
  groupId: string;
  amount: number;
  description: string;
  splitPercentage: number;
  splitWith: SplitMember[];
  createdBy: string;
  intervalUnit: 'month' | 'year';
  nextOccurrence: string;
  totalInstallments: number | null;
  currency?: string;
}) {
  try {
    const { groupId, amount, description, splitPercentage, splitWith, createdBy, intervalUnit, nextOccurrence, totalInstallments, currency = 'BRL' } = data;
    
    const result = await sql`
      INSERT INTO recurring_expenses (
        group_id, amount, description, split_percentage, split_with, created_by, interval_unit, next_occurrence, total_installments, current_installment, currency
      )
      VALUES (
        ${groupId}, ${amount}, ${description}, ${splitPercentage}, ${JSON.stringify(splitWith)}::jsonb, ${createdBy}, ${intervalUnit}, ${new Date(nextOccurrence)}, ${totalInstallments}, 2, ${currency}
      )
      RETURNING id
    `;
    return { success: true, id: result[0]?.id as string };
  } catch (error) {
    console.error('Error creating recurring expense:', error);
    return { success: false, id: null };
  }
}

export async function getRecurringExpenses(groupId: string) {
  try {
    const result = await sql`
      SELECT id, group_id, amount, description, split_percentage, split_with, created_by, interval_unit, next_occurrence, total_installments, current_installment, active, created_at, currency
      FROM recurring_expenses
      WHERE group_id = ${groupId}
      ORDER BY created_at DESC
    `;
    return result as {
      id: string;
      group_id: string;
      amount: number;
      description: string;
      split_percentage: number;
      split_with: SplitMember[];
      created_by: string;
      interval_unit: 'month' | 'year';
      next_occurrence: string;
      total_installments: number | null;
      current_installment: number;
      active: boolean;
      created_at: string;
      currency: string;
    }[];
  } catch (error) {
    console.error('Error fetching recurring expenses:', error);
    return [];
  }
}

export async function toggleRecurringExpenseStatus(id: string, active: boolean) {
  try {
    await sql`
      UPDATE recurring_expenses
      SET active = ${active}
      WHERE id = ${id}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error toggling recurring expense status:', error);
    return { success: false };
  }
}

export async function deleteRecurringExpense(id: string) {
  try {
    await sql`
      DELETE FROM recurring_expenses
      WHERE id = ${id}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error deleting recurring expense:', error);
    return { success: false };
  }
}

export async function processRecurringExpenses(groupId: string) {
  try {
    // Get all active recurring expenses for this group
    const activeRules = await sql`
      SELECT id, group_id, amount, description, split_percentage, split_with, created_by, interval_unit, next_occurrence, total_installments, current_installment, currency
      FROM recurring_expenses
      WHERE group_id = ${groupId} AND active = true
    `;

    const now = new Date();

    for (const rule of activeRules) {
      let nextDate = new Date(rule.next_occurrence);
      let currentInst = rule.current_installment;
      const totalInst = rule.total_installments;
      let ruleActive = true;

      // Keep generating occurrences as long as next_occurrence is in the past or present
      while (nextDate <= now && ruleActive) {
        // Build description
        let generatedDesc = rule.description;
        if (totalInst !== null) {
          generatedDesc = `${rule.description} (${currentInst}/${totalInst})`;
        }

        // Add expense
        const splitAmount = (rule.amount * (rule.split_percentage / 100)) / rule.split_with.length;
        const splitWithInfo = rule.split_with.map((member: SplitMember) => ({
          id: member.id,
          name: member.name,
          splitAmount: splitAmount,
        }));

        await sql`
          INSERT INTO expenses (
            amount, description, group_id, split_percentage, created_by, split_with, created_at, recurring_expense_id, currency
          )
          VALUES (
            ${rule.amount}, ${generatedDesc}, ${rule.group_id}, ${rule.split_percentage}, ${rule.created_by}, ${JSON.stringify(splitWithInfo)}::jsonb, ${nextDate}, ${rule.id}, ${rule.currency || 'BRL'}
          )
        `;

        // Update installment counter and checks
        currentInst++;
        if (totalInst !== null && currentInst > totalInst) {
          ruleActive = false;
        }

        // Advance nextDate
        const newDate = new Date(nextDate);
        if (rule.interval_unit === 'year') {
          newDate.setFullYear(newDate.getFullYear() + 1);
        } else {
          newDate.setMonth(newDate.getMonth() + 1);
        }
        nextDate = newDate;
      }

      // If we generated any new occurrences, update database rule
      if (currentInst !== rule.current_installment || ruleActive === false) {
        await sql`
          UPDATE recurring_expenses
          SET next_occurrence = ${nextDate},
              current_installment = ${currentInst},
              active = ${ruleActive}
          WHERE id = ${rule.id}
        `;
      }
    }
  } catch (error) {
    console.error('Error processing recurring expenses:', error);
  }
}

export async function getRecurringExpenseDetails(recurringExpenseId: string) {
  try {
    // Get the recurring rule
    const rules = await sql`
      SELECT id, group_id, amount, description, split_percentage, split_with, created_by, interval_unit, next_occurrence, total_installments, current_installment, active, created_at, currency
      FROM recurring_expenses
      WHERE id = ${recurringExpenseId}
    `;

    if (rules.length === 0) {
      return { rule: null, installments: [] };
    }

    const rule = rules[0] as {
      id: string;
      group_id: string;
      amount: number;
      description: string;
      split_percentage: number;
      split_with: SplitMember[];
      created_by: string;
      interval_unit: 'month' | 'year';
      next_occurrence: string;
      total_installments: number | null;
      current_installment: number;
      active: boolean;
      created_at: string;
      currency: string;
    };

    // Get all installments generated from this rule
    const installments = await sql`
      SELECT id, description, amount, created_at
      FROM expenses
      WHERE recurring_expense_id = ${recurringExpenseId}
      ORDER BY created_at ASC
    `;

    return {
      rule,
      installments: installments as { id: string; description: string; amount: number; created_at: string }[],
    };
  } catch (error) {
    console.error('Error fetching recurring expense details:', error);
    return { rule: null, installments: [] };
  }
}
