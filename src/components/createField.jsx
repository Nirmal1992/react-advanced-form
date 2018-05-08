/**
 * A high-order component which provides the reference of the field's record to the wrapped
 * component. Used for custom field styling, implementing fields with custom logic, and
 * third-party field components integration.
 */
import React from 'react'
import PropTypes from 'prop-types'
import hoistNonReactStatics from 'hoist-non-react-statics'
import {
  isset,
  camelize,
  debounce,
  CustomPropTypes,
  getComponentName,
  recordUtils,
  rxUtils,
} from '../utils'

/* Default options for `connectField()` HOC */
const defaultOptions = {
  valuePropName: 'value',
  initialValue: '',
  allowMultiple: false,
  mapPropsToField({ fieldRecord }) {
    return fieldRecord
  },
  beforeRegister({ fieldProps }) {
    return fieldProps
  },
  shouldValidateOnMount({ valuePropName, fieldRecord }) {
    const fieldValue = fieldRecord[valuePropName]
    return isset(fieldValue) && fieldValue !== ''
  },
  shouldUpdateRecord({ prevValue, nextValue }) {
    return prevValue !== nextValue
  },
  enforceProps() {
    return {}
  },
}

export default function connectField(options) {
  const hocOptions = { ...defaultOptions, ...options }
  const { valuePropName } = hocOptions

  return function(WrappedComponent) {
    class Field extends React.Component {
      static displayName = `Field.${getComponentName(WrappedComponent)}`

      static propTypes = {
        skip: PropTypes.bool,
      }

      static defaultProps = {
        type: 'text',
        disabled: false,
        required: false,
        skip: false,
      }

      static contextTypes = {
        form: PropTypes.object.isRequired,
        fields: CustomPropTypes.Map.isRequired,
        fieldGroup: PropTypes.arrayOf(PropTypes.string),
      }

      constructor(props, context) {
        super(props, context)
        const { fieldGroup } = context
        const { name } = props

        /* Compose the field path */
        this.fieldPath = fieldGroup ? [...fieldGroup, name] : [name]

        /**
         * Register the field in the parent Form's state and store its internal record reference (contextProps).
         * Also, assume the field's contextProps, since they are composed at this moment. There is no need
         * to wait for the next re-rendering to access them.
         */
        this.contextProps = this.register()
      }

      /* Registers the current field within the parent form's state */
      register() {
        const { props: directProps, context, fieldPath } = this
        const { fields, fieldGroup, form } = context
        const { initialValue } = directProps
        const value = directProps[valuePropName]
        const contextValue = fields.getIn([...fieldPath, valuePropName])

        console.groupCollapsed(`createField @ register @ ${fieldPath.join('.')}`)
        console.log('directProps:', Object.assign({}, directProps))
        console.log('value:', value)
        console.log('initial value:', initialValue)
        console.log('context value:', contextValue)

        /* Get the proper field value */
        const registeredValue = isset(contextValue)
          ? contextValue
          : value || initialValue || hocOptions.initialValue

        console.log('registered value:', registeredValue)

        const { reactiveProps, prunedProps } = rxUtils.getRxProps(directProps)
        console.log({ prunedProps, reactiveProps })

        const initialFieldProps = {
          ref: this,
          fieldGroup,
          name: prunedProps.name,
          type: prunedProps.type,
          valuePropName,
          [valuePropName]: registeredValue,
          initialValue: prunedProps.hasOwnProperty('initialValue') ? initialValue : registeredValue,
          controlled: prunedProps.hasOwnProperty('value'), // TODO Checkboxes are always uncontrolled
          required: prunedProps.required,

          reactiveProps,

          //
          // TODO
          // Debounce an isolate validateField method to handle formless fields
          //
          /**
           * When the validate method is debounced on the form level, different calls to it
           * from different fields are going to overlap and conflict with each other.
           * Wrapping the validate method for each field means that each re-occuring call to that method is
           * going to be debounced relatively to the field, regardless of the other fields being validated.
           */
          debounceValidate: debounce(form.validateField, form.debounceTime),
          skip: prunedProps.skip,

          rule: prunedProps.rule,
          asyncRule: prunedProps.asyncRule,
          onFocus: prunedProps.onFocus,
          onChange: prunedProps.onChange,
          onBlur: prunedProps.onBlur,
        }

        /* (Optional) Alter the field record using HOC options */
        const mappedFieldProps = hocOptions.mapPropsToField({
          fieldRecord: initialFieldProps, // TODO Align naming
          props: prunedProps,
          valuePropName,
          context,
        })

        console.log('should create field record from:', mappedFieldProps)

        const fieldRecord = recordUtils.createField(mappedFieldProps)

        console.warn('fieldRecord', fieldRecord && fieldRecord.toJS())
        console.log('fieldPath:', fieldRecord.fieldPath)
        console.log('valuePropName:', fieldRecord[valuePropName])
        console.log('value:', fieldRecord.value)
        console.log('rxProps:', fieldRecord.reactiveProps)
        console.log(' ')

        console.groupEnd()

        /* Notify the parent Form that a new field prompts to register */
        form.eventEmitter.emit('fieldRegister', {
          fieldProps: fieldRecord,
          fieldOptions: {
            allowMultiple: hocOptions.allowMultiple,
            beforeRegister: hocOptions.beforeRegister,
            shouldValidateOnMount: hocOptions.shouldValidateOnMount({
              fieldRecord,
              props: directProps,
              context: this.context,
              valuePropName,
            }),
          },
        })

        return fieldRecord

        //
        //
        //
        //
        //
        //

        // const defaultFieldRecord = {
        //   /* Internals */
        //   ref: this,
        //   fieldPath,

        //   /* General */
        //   name: directProps.name,
        //   type: directProps.type,
        //   valuePropName,
        //   [valuePropName]: registeredValue,
        //   initialValue: directProps.hasOwnProperty('initialValue') ? initialValue : registeredValue,

        //   /* States */
        //   controlled: directProps.hasOwnProperty('value'), // FIXME checkboxes are never controlled
        //   focused: false,

        //   /* Validation */
        //   errors: null,
        //   required: directProps.required,
        //   expected: true,
        //   skip: directProps.skip,
        //   valid: false,
        //   invalid: false,
        //   validating: false,
        //   validated: false,
        //   validatedSync: false,
        //   validatedAsync: false,
        //   validSync: false,
        //   validAsync: false
        // };
      }

      componentWillReceiveProps(nextProps) {
        const { contextProps } = this
        if (!contextProps) {
          return
        }

        /**
         * Handle value change of controlled fields.
         * The responsibility of value update of controlled fields is delegated to the end developer.
         * However, that still means that the new value should be propagated to the Form's state to guarantee
         * the field's internal record is updated respectively.
         */
        const controlled = contextProps.get('controlled')
        const nextValue = nextProps[valuePropName]
        const prevValue = this.props[valuePropName]

        const shouldUpdateRecord = hocOptions.shouldUpdateRecord({
          nextValue,
          prevValue,
          prevProps: this.props,
          nextProps,
          contextProps,
        })

        if (controlled && shouldUpdateRecord) {
          this.context.form.eventEmitter.emit('fieldChange', {
            event: {
              nativeEvent: {
                isForcedUpdate: true,
              },
            },
            nextValue,
            prevValue,
            fieldProps: contextProps,
          })
        }
      }

      /**
       * Ensure "this.contextProps" reference is updated according to the context updates.
       */
      componentWillUpdate(nextProps, nextState, nextContext) {
        /* Bypass scenarios when field is being updated, but not yet registred within the Form */
        const nextContextProps = nextContext.fields.getIn(this.fieldPath)

        if (!nextContextProps) {
          return
        }

        /* Update the internal reference to contextProps */
        const { props: prevProps, contextProps: prevContextProps } = this
        this.contextProps = nextContextProps

        const fieldPropsChange = camelize(...nextContextProps.fieldPath, 'props', 'change')

        this.context.form.eventEmitter.emit(fieldPropsChange, {
          prevProps,
          nextProps,
          prevContextProps,
          nextContextProps,
        })
      }

      /**
       * Deletes the field's record upon unmounting.
       */
      componentWillUnmount() {
        this.context.form.eventEmitter.emit('fieldUnregister', this.contextProps)
      }

      /**
       * Handle field and inner field component refenreces.
       * @param {ReactComponent} Component
       */
      getInnerRef = (Component) => {
        /**
         * Store inner component reference internally.
         * This way inner reference is accessible by custom field reference like
         * "CustomField.ref(Field).innerRef(Component)".
         */
        this.innerRef = Component

        /**
         * Allow direct reference to inner component.
         * <CustomField innerRef={ ... } />
         *
         * First, check if the component where "fieldProps" are destructued is another
         * React Component. This means, that the end developer wrapped the "input" with
         * another React Component. In that case "innerRef" will not return the actual
         * "input", but custom React Component, which would be the same what "innerRef"
         * references. In that case, omit explicit call of "innerRef".
         */
        if (Component instanceof React.Component) {
          return
        }

        const { innerRef } = this.props
        if (innerRef) {
          innerRef(Component)
        }
      }

      /**
       * Handles field focus.
       * @param {Event} event
       */
      handleFocus = (event) => {
        this.context.form.eventEmitter.emit('fieldFocus', {
          event,
          fieldProps: this.contextProps,
        })
      }

      /**
       * Handles field change.
       * @param {Event} event
       * @param {any} nextValue
       * @param {any} prevValue
       */
      handleChange = (args) => {
        const { event, nextValue: customNextValue, prevValue: customPrevValue } = args
        const { contextProps } = this

        const nextValue = args.hasOwnProperty('nextValue')
          ? customNextValue
          : event.currentTarget[valuePropName]

        const prevValue = args.hasOwnProperty('prevValue')
          ? customPrevValue
          : contextProps.get(valuePropName)

        console.groupCollapsed(`createField @ handleChange @ ${contextProps.fieldPath.join('.')}`)
        console.log('event', event)
        console.log('valuePropName', valuePropName)
        console.log('contextProps', Object.assign({}, contextProps.toJS()))
        console.log('prevValue', prevValue)
        console.log('nextValue', nextValue)
        console.groupEnd()

        this.context.form.eventEmitter.emit('fieldChange', {
          event,
          nextValue,
          prevValue,
          fieldProps: contextProps,
        })
      }

      /**
       * Handles field blur.
       * @param {Event} event
       */
      handleBlur = (event) => {
        this.context.form.eventEmitter.emit('fieldBlur', {
          event,
          fieldProps: this.contextProps,
        })
      }

      render() {
        const { props, contextProps } = this

        /* Reference to the enforced props from the HOC options */
        const enforcedProps = hocOptions.enforceProps({ props, contextProps })

        /* A mirror reference to "contextProps", an internal field record stored in Form's state */
        const fieldState = contextProps.toJS()
        const { valuePropName } = fieldState

        /* Props to assign to the field component directly (input, select, etc.) */
        const fieldProps = {
          name: fieldState.name,
          type: fieldState.type,
          [valuePropName]: fieldState.controlled
            ? props[valuePropName] || ''
            : fieldState[valuePropName],
          required: fieldState.required,
          disabled: this.props.disabled,

          /* Assign/override the props provided via {options.enforceProps()} */
          ...enforcedProps,

          /* Reference */
          ref: this.getInnerRef,

          /* Explicitly assign event handlers to prevent unwanted override */
          onFocus: this.handleFocus,
          onChange: (event) => this.handleChange({ event }),
          onBlur: this.handleBlur,
        }

        return (
          <WrappedComponent
            {...props}
            fieldProps={fieldProps}
            fieldState={fieldState}
            handleFieldFocus={this.handleFocus}
            handleFieldChange={this.handleChange}
            handleFieldBlur={this.handleBlur}
          />
        )
      }
    }

    return hoistNonReactStatics(Field, WrappedComponent)
  }
}
