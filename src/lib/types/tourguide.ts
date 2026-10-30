import type { Side, AlignedPlacement } from '@floating-ui/core';

// La librería no expone tipos propios (`types/` incluye los .d.ts pero el
// paquete no los declara en su entry): este wrapper replica la API que usa la
// app (copia de `donde-esta-tu-local/src/lib/types/tourguide.ts`). Si la
// librería publica tipos algún día, esto se jubila.

export interface TourGuideStep {
	title?: string;
	content: string | HTMLElement | Element;
	target?: HTMLElement | Element | HTMLInputElement | string | null;
	dialogTarget?: HTMLElement | Element | HTMLInputElement | string | null;
	fixed?: boolean;
	order?: number;
	group?: string;
	propagateEvents?: boolean;
	beforeEnter?: (currentStep: TourGuideStep, nextStep: TourGuideStep) => void | Promise<unknown>;
	afterEnter?: (currentStep: TourGuideStep, nextStep: TourGuideStep) => void | Promise<unknown>;
	beforeLeave?: (currentStep: TourGuideStep, nextStep: TourGuideStep) => void | Promise<unknown>;
	afterLeave?: (currentStep: TourGuideStep, nextStep: TourGuideStep) => void | Promise<unknown>;
}

export interface TourGuideOptions {
	autoScroll?: boolean;
	autoScrollSmooth?: boolean;
	autoScrollOffset?: number;
	backdropClass?: string;
	backdropAnimate?: boolean;
	backdropColor?: string;
	targetPadding?: number;
	dialogClass?: string;
	allowDialogOverlap?: boolean;
	dialogZ?: number;
	dialogWidth?: number;
	dialogMaxWidth?: number;
	dialogAnimate?: boolean;
	dialogPlacement?: Side | AlignedPlacement;
	nextLabel?: string;
	prevLabel?: string;
	finishLabel?: string;
	hideNext?: boolean;
	hidePrev?: boolean;
	completeOnFinish?: boolean;
	keyboardControls?: boolean;
	exitOnEscape?: boolean;
	exitOnClickOutside?: boolean;
	showStepDots?: boolean;
	stepDotsPlacement?: 'footer' | 'body';
	showButtons?: boolean;
	showStepProgress?: boolean;
	progressBar?: string;
	closeButton?: boolean;
	rememberStep?: boolean;
	debug?: boolean;
	steps?: TourGuideStep[];
	activeStep?: number;
	activeStepInteraction?: boolean;
}

export declare class TourGuideClient {
	backdrop: HTMLElement;
	dialog: HTMLElement;
	group: string;
	isVisible: boolean;
	activeStep: number;
	tourSteps: TourGuideStep[];
	options: TourGuideOptions;
	isFinished: (tourGroup?: string) => boolean;

	constructor(options?: TourGuideOptions);

	start(group?: string): Promise<unknown>;
	visitStep(stepIndex: number | 'next' | 'prev'): Promise<unknown>;
	addSteps(steps: TourGuideStep[]): Promise<void>;
	nextStep(): Promise<unknown>;
	prevStep(): Promise<unknown>;
	exit(): Promise<unknown>;
	refresh(): Promise<unknown>;
	refreshDialog(): Promise<unknown>;
	finishTour(exit?: boolean, tourGroup?: string): Promise<boolean>;
	updatePositions(): Promise<unknown>;
	deleteFinishedTour(groupKey?: string | 'all'): void;
	setOptions(options: TourGuideOptions): Promise<TourGuideClient>;

	readonly onFinish: (callback: () => void) => void;
	readonly onBeforeExit: (callback: () => void) => void;
	readonly onAfterExit: (callback: () => void) => void;
	readonly onBeforeStepChange: (
		callback: (currentStepIndex: number, nextStepIndex: number) => void | Promise<unknown>
	) => void;
	readonly onAfterStepChange: (
		callback: (currentStepIndex: number, nextStepIndex: number) => void | Promise<unknown>
	) => void;
}
