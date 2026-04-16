import { StepUpGuard } from '@/components/step-up-guard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <StepUpGuard scope="admin">{children}</StepUpGuard>;
}
