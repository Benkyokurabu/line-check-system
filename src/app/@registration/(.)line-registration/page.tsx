import RegistrationWorkspace from "@/app/line-registration/workspace";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <RegistrationWorkspace params={await searchParams} overlay />;
}
