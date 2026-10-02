import RegistrationWorkspace from "./workspace";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <RegistrationWorkspace params={await searchParams} />;
}
