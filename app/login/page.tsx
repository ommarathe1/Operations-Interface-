import type {Metadata} from "next";
import {getChatGPTUser,chatGPTSignInPath,chatGPTSignOutPath} from "../chatgpt-auth";
import LoginScreen from "./screen";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Sign in | Newtonite Operations",robots:{index:false,follow:false}};

export default async function LoginPage(){
  const user=await getChatGPTUser();
  return <LoginScreen user={user?{name:user.displayName,email:user.email}:null} signInHref={chatGPTSignInPath("/")} signOutHref={chatGPTSignOutPath("/login")}/>;
}
