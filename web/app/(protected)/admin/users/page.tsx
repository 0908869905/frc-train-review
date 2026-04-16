import { redirect } from 'next/navigation';

export default function OldUsersPage(): never {
  redirect('/admin/members');
}
