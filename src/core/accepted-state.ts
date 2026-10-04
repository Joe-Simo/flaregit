import type {AcceptedState,CommittedAcceptedState,UnbornAcceptedState} from "./types";
export function unbornAcceptedState():UnbornAcceptedState{return{kind:"unborn",currentCommit:null,acceptedAt:null,buildDigest:null,activeRequirements:[],history:[]};}
/** Update the whole discriminated value when the first real acceptance lands. */
export function committedAcceptedState(value:Omit<CommittedAcceptedState,"kind">):CommittedAcceptedState{
 if(!/^[a-f0-9]{40}$/.test(value.currentCommit)||/^0{40}$/.test(value.currentCommit)||!Number.isFinite(Date.parse(value.acceptedAt)))throw Error("Accepted repository state requires a real committed receipt");
 return {...value,kind:"committed"};
}
export function hasAcceptedCommit(state:AcceptedState):state is CommittedAcceptedState{return state.kind!=="unborn";}
